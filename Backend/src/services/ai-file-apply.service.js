const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const FileSystemService = require('./filesystem.service');
const AiContextService = require('./ai-context.service');

class AiFileApplyService {
  /**
   * Validates and applies an approved proposal to the local filesystem
   *
   * @param {Object} params
   * @param {Object} params.project - Project mongoose model
   * @param {Object} params.conversation - Conversation mongoose model
   * @param {string} params.messageId - ID of the message containing the proposal
   * @param {string} params.userId - Authenticated user ID
   * @returns {Promise<{ success: boolean, appliedFiles: string[], message: string }>}
   */
  static async applyChanges({ project, conversation, messageId, userId }) {
    // 1. Verify project ownership
    if (!project) {
      const err = new Error('Project not found');
      err.status = 404;
      throw err;
    }
    if (project.ownerId.toString() !== userId) {
      const err = new Error('You do not have permission to modify this project');
      err.status = 403;
      throw err;
    }
    if (project.projectType !== 'local' || !project.localPath) {
      const err = new Error('Only local projects support direct filesystem modifications');
      err.status = 400;
      throw err;
    }

    // 2. Verify conversation ownership
    if (!conversation) {
      const err = new Error('Conversation not found');
      err.status = 404;
      throw err;
    }
    if (conversation.userId.toString() !== userId) {
      const err = new Error('You do not own this conversation');
      err.status = 403;
      throw err;
    }

    // 3. Find target message and proposal
    const message = conversation.messages.find(m => m.id === messageId);
    if (!message || !message.proposal) {
      const err = new Error('Proposed changes not found in this message');
      err.status = 404;
      throw err;
    }

    if (message.proposal.status === 'applied') {
      const err = new Error('These changes have already been applied.');
      err.status = 400;
      throw err;
    }

    if (message.proposal.status === 'rejected') {
      const err = new Error('These changes were previously rejected. Please ask the AI for a new proposal.');
      err.status = 400;
      throw err;
    }

    const basePath = path.resolve(project.localPath);
    const changes = message.proposal.changes || [];
    if (changes.length === 0) {
      const err = new Error('No file changes to apply');
      err.status = 400;
      throw err;
    }

    // 4. Pre-validation and Conflict Detection for all files before any writes
    for (const change of changes) {
      const relPath = change.path.trim().replace(/\\/g, '/');

      // Reject secret files
      if (AiContextService.isSecretPath(relPath)) {
        const err = new Error(`Security Exception: Modifying sensitive or secret file "${relPath}" is prohibited.`);
        err.status = 403;
        throw err;
      }

      // Check path traversal & resolve target absolute path
      let targetPath;
      try {
        targetPath = FileSystemService.getSecurePath(basePath, relPath);
      } catch (securityErr) {
        const err = new Error(`Security Exception: Path traversal attempt detected on "${relPath}"`);
        err.status = 403;
        throw err;
      }

      // Symlink escape check
      try {
        const lstat = await fs.lstat(targetPath);
        if (lstat.isSymbolicLink()) {
          const real = await fs.realpath(targetPath);
          if (!real.startsWith(basePath)) {
            const err = new Error(`Security Exception: Symlink escape detected on "${relPath}"`);
            err.status = 403;
            throw err;
          }
        }
      } catch {
        // File doesn't exist yet, valid for create
      }

      // Conflict detection for 'edit' operations
      if (change.operation === 'edit') {
        const fileExists = await FileSystemService.exists(basePath, relPath);
        if (!fileExists) {
          const err = new Error(`File "${relPath}" no longer exists on disk. Cannot apply edit.`);
          err.status = 404;
          throw err;
        }

        const currentContent = await fs.readFile(targetPath, 'utf8');
        const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex');

        if (change.originalHash && currentHash !== change.originalHash) {
          const conflictErr = new Error(
            `Conflict detected: File "${relPath}" was modified on disk after this preview was generated. Writing aborted to prevent overwriting newer changes. Please ask AI for an updated diff.`
          );
          conflictErr.status = 409;
          conflictErr.code = 'STALE_DIFF_CONFLICT';
          throw conflictErr;
        }
      }
    }

    // 5. Apply changes safely to disk
    const appliedFiles = [];
    const writeErrors = [];

    for (const change of changes) {
      const relPath = change.path.trim().replace(/\\/g, '/');
      const targetPath = FileSystemService.getSecurePath(basePath, relPath);

      try {
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        if (change.operation === 'create') {
          await fs.writeFile(targetPath, change.content, 'utf8');
          appliedFiles.push(relPath);
        } else if (change.operation === 'edit') {
          // Atomic write: write to temp file then rename
          const tempPath = `${targetPath}.devpilot_tmp_${Date.now()}`;
          await fs.writeFile(tempPath, change.content, 'utf8');
          await fs.rename(tempPath, targetPath);
          appliedFiles.push(relPath);
        }
      } catch (writeErr) {
        console.error(`[AiFileApply] Failed writing "${relPath}":`, writeErr);
        writeErrors.push({ path: relPath, error: writeErr.message });
      }
    }

    if (writeErrors.length > 0) {
      // Partial failure
      const err = new Error(
        `Failed to write some files: ${writeErrors.map(e => `${e.path} (${e.error})`).join(', ')}. Applied: ${appliedFiles.join(', ') || 'none'}`
      );
      err.status = 500;
      err.appliedFiles = appliedFiles;
      throw err;
    }

    // 6. Update proposal status in MongoDB Conversation
    message.proposal.status = 'applied';
    await conversation.save();

    return {
      success: true,
      appliedFiles,
      message: `Successfully applied ${appliedFiles.length} file change(s) to the local filesystem.`
    };
  }

  /**
   * Marks a proposal as rejected
   */
  static async rejectChanges({ conversation, messageId, userId }) {
    if (!conversation) {
      const err = new Error('Conversation not found');
      err.status = 404;
      throw err;
    }
    if (conversation.userId.toString() !== userId) {
      const err = new Error('You do not own this conversation');
      err.status = 403;
      throw err;
    }

    const message = conversation.messages.find(m => m.id === messageId);
    if (!message || !message.proposal) {
      const err = new Error('Proposed changes not found');
      err.status = 404;
      throw err;
    }

    message.proposal.status = 'rejected';
    await conversation.save();

    return {
      success: true,
      message: 'Proposed changes were rejected. Files on disk remain unchanged.'
    };
  }
}

module.exports = AiFileApplyService;
