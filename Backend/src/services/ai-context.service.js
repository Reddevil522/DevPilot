const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const FileSystemService = require('./filesystem.service');

// Secret file and directory blacklists
const SECRET_NAME_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|pfx|p12|crt|cer|secret|token)$/i,
  /^id_(rsa|ed25519|ecdsa)(.*)?$/i,
  /.*secret.*/i,
  /.*credential.*/i,
  /.*token.*/i,
  /^\.npmrc$/i,
  /^\.htpasswd$/i,
  /^vault.*/i,
];

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.angular',
  '.next',
  '.cache',
  'coverage',
  'logs',
  '.devpilot',
  '.idea',
  '.vscode',
  '.venv',
  'vendor',
  '__pycache__'
]);

class AiContextService {
  /**
   * Checks if a filename or path matches secret / sensitive patterns
   */
  static isSecretPath(filePath) {
    if (!filePath) return false;
    const base = path.basename(filePath);
    return SECRET_NAME_PATTERNS.some(regex => regex.test(base));
  }

  /**
   * Reads .gitignore or .devpilotignore rules if available
   */
  static async loadIgnoreRules(basePath) {
    const rules = [];
    for (const ignoreFile of ['.gitignore', '.devpilotignore']) {
      try {
        const fullPath = path.join(basePath, ignoreFile);
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
        rules.push(...lines);
      } catch {
        // file doesn't exist, proceed
      }
    }
    return rules;
  }

  /**
   * Checks if a relative path is ignored based on loaded rules
   */
  static isIgnoredByRule(relPath, rules) {
    const normalized = relPath.replace(/\\/g, '/');
    for (const rule of rules) {
      const cleanRule = rule.replace(/\/$/, '');
      if (normalized === cleanRule || normalized.startsWith(cleanRule + '/') || normalized.endsWith('/' + cleanRule)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Builds a concise directory tree representation (max depth 3, max entries 100)
   */
  static async buildProjectTree(basePath, ignoreRules = [], currentRel = '', depth = 0, counter = { count: 0 }) {
    if (depth > 3 || counter.count >= 100) return [];
    
    let entries;
    const currentFull = path.join(basePath, currentRel);
    try {
      entries = await fs.readdir(currentFull, { withFileTypes: true });
    } catch {
      return [];
    }

    const items = [];
    for (const entry of entries) {
      if (counter.count >= 100) break;
      const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;

      if (IGNORED_DIRS.has(entry.name) || this.isSecretPath(entry.name) || this.isIgnoredByRule(rel, ignoreRules)) {
        continue;
      }

      counter.count++;
      if (entry.isDirectory()) {
        const children = await this.buildProjectTree(basePath, ignoreRules, rel, depth + 1, counter);
        items.push({ name: entry.name, type: 'dir', path: rel, children });
      } else {
        items.push({ name: entry.name, type: 'file', path: rel });
      }
    }
    return items;
  }

  /**
   * Renders tree items as indented string
   */
  static formatTreeString(items, indent = '') {
    let out = '';
    for (const item of items) {
      if (item.type === 'dir') {
        out += `${indent}📁 ${item.name}/\n`;
        if (item.children && item.children.length > 0) {
          out += this.formatTreeString(item.children, indent + '  ');
        }
      } else {
        out += `${indent}📄 ${item.name}\n`;
      }
    }
    return out;
  }

  /**
   * Safe file reader that strictly enforces no secret access and no path traversal
   */
  static async safeReadFile(basePath, targetRelPath, maxChars = 15000) {
    if (!basePath || !targetRelPath) return null;
    if (this.isSecretPath(targetRelPath)) return null;

    try {
      const securePath = FileSystemService.getSecurePath(basePath, targetRelPath);
      
      // Ensure it is a regular file and not a symlink escaping root
      const lstat = await fs.lstat(securePath);
      if (lstat.isSymbolicLink()) {
        const real = await fs.realpath(securePath);
        if (!real.startsWith(path.resolve(basePath))) {
          return null; // Symlink escape
        }
      }

      const content = await fs.readFile(securePath, 'utf8');
      if (content.length > maxChars) {
        return content.slice(0, maxChars) + `\n\n... [Content truncated after ${maxChars} characters]`;
      }
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Intelligently selects related files based on query, active file, and error context
   */
  static async findRelatedFiles(basePath, activeFilePath, userPrompt = '', errorContext = '') {
    const related = [];
    const query = (userPrompt + ' ' + errorContext).toLowerCase();

    // 1. Angular companion files: If active file is *.component.ts, look for .html and .css/.scss
    if (activeFilePath && activeFilePath.endsWith('.component.ts')) {
      const baseComponent = activeFilePath.slice(0, -'.component.ts'.length);
      const candidates = [
        `${baseComponent}.component.html`,
        `${baseComponent}.component.css`,
        `${baseComponent}.component.scss`,
        `${baseComponent}.service.ts`
      ];

      for (const cand of candidates) {
        if (await FileSystemService.exists(basePath, cand)) {
          const content = await this.safeReadFile(basePath, cand, 8000);
          if (content) related.push({ path: cand, content });
        }
      }
    }

    // 2. Auth query: inspect authentication files
    if (query.includes('auth') || query.includes('login') || query.includes('jwt') || query.includes('token')) {
      const authCandidates = [
        'src/services/auth.service.js',
        'src/services/auth.service.ts',
        'src/routes/auth.routes.js',
        'src/controllers/auth.controller.js',
        'src/middleware/auth.middleware.js',
        'src/models/user.model.js',
        'frontend/src/app/core/services/auth.service.ts',
        'Backend/src/services/auth.service.js',
        'Backend/src/routes/auth.routes.js',
        'Backend/src/controllers/auth.controller.js',
        'Backend/src/middleware/auth.middleware.js',
        'Backend/src/models/user.model.js'
      ];

      for (const cand of authCandidates) {
        if (related.length >= 3) break;
        if (cand !== activeFilePath && await FileSystemService.exists(basePath, cand)) {
          const content = await this.safeReadFile(basePath, cand, 8000);
          if (content) related.push({ path: cand, content });
        }
      }
    }

    // 3. Project explanation: README.md & package.json
    if (query.includes('how does my project work') || query.includes('explain project') || query.includes('architecture') || query.includes('readme')) {
      const overviewFiles = ['README.md', 'package.json', 'backend/package.json', 'frontend/package.json'];
      for (const f of overviewFiles) {
        if (related.length >= 4) break;
        if (f !== activeFilePath && await FileSystemService.exists(basePath, f)) {
          const content = await this.safeReadFile(basePath, f, 6000);
          if (content) related.push({ path: f, content });
        }
      }
    }

    // 4. Compiler / terminal error analysis: Extract filenames mentioned in error text
    if (errorContext || query.includes('error')) {
      const combinedText = errorContext + ' ' + userPrompt;
      const fileMatches = combinedText.match(/([a-zA-Z0-9_\-/\\]+\.(ts|js|html|css|json))/g) || [];
      for (const match of fileMatches) {
        if (related.length >= 4) break;
        const normalized = match.replace(/\\/g, '/').replace(/^\.?\//, '');
        if (normalized !== activeFilePath && !this.isSecretPath(normalized)) {
          if (await FileSystemService.exists(basePath, normalized)) {
            const content = await this.safeReadFile(basePath, normalized, 8000);
            if (content) related.push({ path: normalized, content });
          }
        }
      }
    }

    return related;
  }

  /**
   * Main context assembly method
   */
  static async buildContext({ project, activeFilePath, selectedCode, userPrompt, errorContext }) {
    if (!project || !project.localPath) {
      return '';
    }

    const basePath = project.localPath;
    if (!fsSync.existsSync(basePath)) {
      return `[PROJECT WARNING: Project root directory "${basePath}" not found on local disk.]`;
    }

    const ignoreRules = await this.loadIgnoreRules(basePath);
    const tree = await this.buildProjectTree(basePath, ignoreRules);
    const treeStr = this.formatTreeString(tree);

    let context = `=== ACTIVE DEV_PILOT PROJECT CONTEXT ===\n`;
    context += `Project Name: ${project.name}\n`;
    context += `Technology: ${project.technology || 'N/A'}\n`;
    context += `Template: ${project.template || 'N/A'}\n`;
    context += `Local Root: ${project.localPath}\n\n`;

    if (treeStr) {
      context += `--- Project Structure (filtered) ---\n${treeStr}\n\n`;
    }

    // Active File
    if (activeFilePath && !this.isSecretPath(activeFilePath)) {
      const activeContent = await this.safeReadFile(basePath, activeFilePath, 15000);
      if (activeContent !== null) {
        context += `--- Active Open File: ${activeFilePath} ---\n\`\`\`\n${activeContent}\n\`\`\`\n\n`;
      }
    }

    // Selected Code
    if (selectedCode && selectedCode.trim()) {
      const codeSnippet = selectedCode.trim().slice(0, 5000);
      context += `--- User Selected Code (from editor) ---\n\`\`\`\n${codeSnippet}\n\`\`\`\n\n`;
    }

    // Error Context
    if (errorContext && errorContext.trim()) {
      context += `--- Compiler / Terminal Error ---\n\`\`\`\n${errorContext.trim().slice(0, 5000)}\n\`\`\`\n\n`;
    }

    // Related Files
    const related = await this.findRelatedFiles(basePath, activeFilePath, userPrompt, errorContext);
    for (const rel of related) {
      context += `--- Related Project File: ${rel.path} ---\n\`\`\`\n${rel.content}\n\`\`\`\n\n`;
    }

    // Total context size enforcement (hard cap at 30,000 characters)
    if (context.length > 30000) {
      context = context.slice(0, 30000) + '\n\n[Context truncated to adhere to 30KB safety limit]';
    }

    return context;
  }

  /**
   * Builds a structured ProjectContextPayload for the Python AI service
   * and also provides the rendered context string.
   */
  static async buildStructuredContext({ project, activeFilePath, selectedCode, userPrompt, errorContext }) {
    if (!project || !project.localPath) {
      return {
        contextData: null,
        contextString: ''
      };
    }

    const basePath = project.localPath;
    if (!fsSync.existsSync(basePath)) {
      return {
        contextData: null,
        contextString: `[PROJECT WARNING: Project root directory "${basePath}" not found on local disk.]`
      };
    }

    const ignoreRules = await this.loadIgnoreRules(basePath);
    const tree = await this.buildProjectTree(basePath, ignoreRules);
    const treeStr = this.formatTreeString(tree);

    // Collect list of authorized relative file paths from the tree
    const authorizedFiles = [];
    const collectPaths = (items) => {
      for (const item of items) {
        if (item.type === 'file') {
          authorizedFiles.push(item.path);
        } else if (item.children) {
          collectPaths(item.children);
        }
      }
    };
    collectPaths(tree);

    let activeFileItem = null;
    if (activeFilePath && !this.isSecretPath(activeFilePath)) {
      const activeContent = await this.safeReadFile(basePath, activeFilePath, 15000);
      if (activeContent !== null) {
        const hash = crypto.createHash('sha256').update(activeContent).digest('hex');
        activeFileItem = {
          path: activeFilePath.replace(/\\/g, '/').replace(/^\.?\//, ''),
          content: activeContent,
          is_active: true,
          original_hash: hash
        };
      }
    }

    const related = await this.findRelatedFiles(basePath, activeFilePath, userPrompt, errorContext);
    const relatedItems = [];
    for (const rel of related) {
      const hash = crypto.createHash('sha256').update(rel.content).digest('hex');
      relatedItems.push({
        path: rel.path.replace(/\\/g, '/').replace(/^\.?\//, ''),
        content: rel.content,
        is_active: false,
        original_hash: hash
      });
    }

    const contextData = {
      project_id: project._id ? project._id.toString() : null,
      project_name: project.name,
      technology: project.technology || 'N/A',
      tree_summary: treeStr,
      authorized_files: authorizedFiles,
      active_file: activeFileItem,
      related_files: relatedItems,
      selected_code: selectedCode ? selectedCode.trim().slice(0, 5000) : null,
      error_context: errorContext ? errorContext.trim().slice(0, 5000) : null
    };

    const contextString = await this.buildContext({
      project,
      activeFilePath,
      selectedCode,
      userPrompt,
      errorContext
    });

    return {
      contextData,
      contextString
    };
  }
}

module.exports = AiContextService;
