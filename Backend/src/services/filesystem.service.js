const fs = require('fs').promises;
const path = require('path');

class FileSystemService {
  /**
   * Validates a single file or directory name segment
   * @param {string} name
   * @returns {string|null} Error message or null if valid
   */
  static validatePathSegment(name) {
    if (!name || typeof name !== 'string') return 'Name cannot be empty';
    const trimmed = name.trim();
    if (!trimmed) return 'Name cannot be empty or whitespace';
    if (/[<>:"/\\|?*]/.test(trimmed)) {
      return 'Name cannot contain invalid characters: < > : " / \\ | ? *';
    }
    const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
    if (reservedRegex.test(trimmed)) {
      return `"${trimmed}" is a reserved Windows device name`;
    }
    return null;
  }

  /**
   * Validates a full relative path against traversal, invalid characters, and reserved names
   * @param {string} targetPath
   * @param {boolean} allowEmpty
   * @returns {string|null} Error message or null if valid
   */
  static validateRelativePath(targetPath, allowEmpty = false) {
    if (!targetPath || !targetPath.trim()) {
      if (allowEmpty) return null;
      return 'Path cannot be empty';
    }
    if (/^[a-zA-Z]:[/\\]/.test(targetPath) || targetPath.startsWith('\\\\')) {
      return 'Absolute paths are not allowed';
    }
    const normalized = path.normalize(targetPath).replace(/^[/\\]+/, '');
    const segments = normalized.split(/[/\\]+/);
    for (const seg of segments) {
      if (seg === '..') return 'Path traversal (..) is not allowed';
      if (seg === '.' || seg === '') continue;
      const err = this.validatePathSegment(seg);
      if (err) return err;
    }
    return null;
  }

  /**
   * Resolves and secures a path against directory traversal
   * @param {string} basePath - The project root path
   * @param {string} targetPath - The requested relative path
   * @returns {string} The resolved absolute path
   * @throws {Error} If path traversal or security violation is detected
   */
  static getSecurePath(basePath, targetPath) {
    if (!basePath) {
      const err = new Error('Base path is required');
      err.status = 400;
      throw err;
    }
    
    const absoluteBasePath = path.resolve(basePath);
    if (!targetPath || targetPath.trim() === '' || targetPath === '.') {
      return absoluteBasePath;
    }

    if (/^[a-zA-Z]:[/\\]/.test(targetPath) || targetPath.startsWith('\\\\')) {
      const err = new Error('Absolute paths supplied by client are not allowed');
      err.status = 400;
      throw err;
    }

    const cleanRel = path.normalize(targetPath).replace(/^[/\\]+/, '');
    const resolvedPath = path.resolve(absoluteBasePath, cleanRel);
    
    const relative = path.relative(absoluteBasePath, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      const err = new Error(`Security Exception: Path traversal detected. Access denied to ${targetPath}`);
      err.status = 400;
      throw err;
    }

    return resolvedPath;
  }

  /**
   * Asserts that a path does not escape the workspace root via symlinks.
   * @param {string} basePath
   * @param {string} securePath
   */
  static async assertWithinRoot(basePath, securePath) {
    try {
      const real = await fs.realpath(securePath);
      const absBase = await fs.realpath(basePath).catch(() => path.resolve(basePath));
      const rel = path.relative(absBase, real);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        const err = new Error('Security Exception: Symlink target is outside the project workspace');
        err.status = 400;
        throw err;
      }
    } catch (e) {
      if (e.status) throw e;
      // If securePath doesn't exist yet, verify closest existing ancestor
      let parent = path.dirname(securePath);
      while (parent && parent !== path.dirname(parent)) {
        let realParent;
        try {
          realParent = await fs.realpath(parent);
        } catch (_) {
          parent = path.dirname(parent);
          continue;
        }
        const absBase = await fs.realpath(basePath).catch(() => path.resolve(basePath));
        const rel = path.relative(absBase, realParent);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          const err = new Error('Security Exception: Symlink ancestor is outside the project workspace');
          err.status = 400;
          throw err;
        }
        break;
      }
    }
  }

  static async readFile(basePath, filePath) {
    const securePath = this.getSecurePath(basePath, filePath);
    await this.assertWithinRoot(basePath, securePath);
    return await fs.readFile(securePath, 'utf8');
  }

  static async writeFile(basePath, filePath, content) {
    const securePath = this.getSecurePath(basePath, filePath);
    await this.assertWithinRoot(basePath, securePath);
    await fs.mkdir(path.dirname(securePath), { recursive: true });
    await fs.writeFile(securePath, content, 'utf8');
  }

  static async createFile(basePath, filePath, initialContent = '') {
    const valErr = this.validateRelativePath(filePath);
    if (valErr) {
      const err = new Error(valErr);
      err.status = 400;
      throw err;
    }

    const securePath = this.getSecurePath(basePath, filePath);
    await this.assertWithinRoot(basePath, securePath);
    try {
      await fs.access(securePath);
      const err = new Error('File already exists');
      err.status = 409;
      throw err;
    } catch (e) {
      if (e.status === 409) throw e;
      await fs.mkdir(path.dirname(securePath), { recursive: true });
      await fs.writeFile(securePath, initialContent, 'utf8');
    }
  }

  static async createFolder(basePath, folderPath) {
    const valErr = this.validateRelativePath(folderPath);
    if (valErr) {
      const err = new Error(valErr);
      err.status = 400;
      throw err;
    }

    const securePath = this.getSecurePath(basePath, folderPath);
    await this.assertWithinRoot(basePath, securePath);
    try {
      await fs.access(securePath);
      const err = new Error('Folder already exists');
      err.status = 409;
      throw err;
    } catch (e) {
      if (e.status === 409) throw e;
      await fs.mkdir(securePath, { recursive: true });
    }
  }

  static async deleteFile(basePath, filePath) {
    if (!filePath || filePath.trim() === '' || filePath === '.' || filePath === '/' || filePath === '\\') {
      const err = new Error('Cannot delete project root');
      err.status = 400;
      throw err;
    }

    const securePath = this.getSecurePath(basePath, filePath);
    await this.assertWithinRoot(basePath, securePath);
    if (securePath.toLowerCase() === path.resolve(basePath).toLowerCase()) {
      const err = new Error('Cannot delete project root');
      err.status = 400;
      throw err;
    }

    try {
      await fs.access(securePath);
    } catch {
      const err = new Error('File not found');
      err.status = 404;
      throw err;
    }

    try {
      await fs.unlink(securePath);
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        const err = new Error('Permission denied: Unable to delete file');
        err.status = 403;
        throw err;
      }
      if (e.code === 'EBUSY') {
        const err = new Error('File is currently locked or in use');
        err.status = 409;
        throw err;
      }
      if (e.code === 'ENOENT') {
        const err = new Error('File not found');
        err.status = 404;
        throw err;
      }
      const err = new Error('Failed to delete file');
      err.status = 500;
      throw err;
    }
  }

  static async deleteFolder(basePath, folderPath) {
    if (!folderPath || folderPath.trim() === '' || folderPath === '.' || folderPath === '/' || folderPath === '\\') {
      const err = new Error('Cannot delete project root');
      err.status = 400;
      throw err;
    }

    const securePath = this.getSecurePath(basePath, folderPath);
    await this.assertWithinRoot(basePath, securePath);
    if (securePath.toLowerCase() === path.resolve(basePath).toLowerCase()) {
      const err = new Error('Cannot delete project root');
      err.status = 400;
      throw err;
    }

    try {
      await fs.access(securePath);
    } catch {
      const err = new Error('Folder not found');
      err.status = 404;
      throw err;
    }

    try {
      await fs.rm(securePath, { recursive: true, force: true });
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        const err = new Error('Permission denied: Unable to delete folder');
        err.status = 403;
        throw err;
      }
      if (e.code === 'EBUSY') {
        const err = new Error('Folder is currently locked or in use');
        err.status = 409;
        throw err;
      }
      if (e.code === 'ENOENT') {
        const err = new Error('Folder not found');
        err.status = 404;
        throw err;
      }
      const err = new Error('Failed to delete folder');
      err.status = 500;
      throw err;
    }
  }

  static async rename(basePath, oldPath, newPath) {
    if (!oldPath || !newPath) {
      const err = new Error('Both oldPath and newPath are required');
      err.status = 400;
      throw err;
    }

    if (oldPath === '.' || oldPath === '/' || oldPath === '\\') {
      const err = new Error('Cannot rename project root');
      err.status = 400;
      throw err;
    }

    const valErr = this.validateRelativePath(newPath);
    if (valErr) {
      const err = new Error(valErr);
      err.status = 400;
      throw err;
    }

    const secureOldPath = this.getSecurePath(basePath, oldPath);
    const secureNewPath = this.getSecurePath(basePath, newPath);
    await this.assertWithinRoot(basePath, secureOldPath);
    await this.assertWithinRoot(basePath, secureNewPath);

    try {
      await fs.access(secureOldPath);
    } catch {
      const err = new Error('Source file or folder not found');
      err.status = 404;
      throw err;
    }

    if (secureOldPath.toLowerCase() !== secureNewPath.toLowerCase()) {
      try {
        await fs.access(secureNewPath);
        const err = new Error('Destination already exists');
        err.status = 409;
        throw err;
      } catch (e) {
        if (e.status === 409) throw e;
      }
    }

    await fs.mkdir(path.dirname(secureNewPath), { recursive: true });
    await fs.rename(secureOldPath, secureNewPath);
  }

  static async exists(basePath, targetPath) {
    try {
      const securePath = this.getSecurePath(basePath, targetPath);
      await fs.access(securePath);
      return true;
    } catch {
      return false;
    }
  }

  static async stat(basePath, targetPath) {
    const securePath = this.getSecurePath(basePath, targetPath);
    return await fs.stat(securePath);
  }
}

module.exports = FileSystemService;
