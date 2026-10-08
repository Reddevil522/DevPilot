const fs = require('fs').promises;
const path = require('path');

class FileSystemService {
  /**
   * Resolves and secures a path against directory traversal
   * @param {string} basePath - The project root path
   * @param {string} targetPath - The requested relative or absolute path
   * @returns {string} The resolved absolute path
   * @throws {Error} If path traversal is detected
   */
  static getSecurePath(basePath, targetPath) {
    if (!basePath) throw new Error('Base path is required');
    if (!targetPath) return basePath;
    
    const absoluteBasePath = path.resolve(basePath);
    const resolvedPath = path.isAbsolute(targetPath) 
      ? path.resolve(targetPath) 
      : path.resolve(absoluteBasePath, targetPath);
      
    if (!resolvedPath.startsWith(absoluteBasePath)) {
      throw new Error(`Security Exception: Path traversal detected. Access denied to ${targetPath}`);
    }
    
    return resolvedPath;
  }

  static async readFile(basePath, filePath) {
    const securePath = this.getSecurePath(basePath, filePath);
    return await fs.readFile(securePath, 'utf8');
  }

  static async writeFile(basePath, filePath, content) {
    const securePath = this.getSecurePath(basePath, filePath);
    await fs.mkdir(path.dirname(securePath), { recursive: true });
    await fs.writeFile(securePath, content, 'utf8');
  }

  static async createFile(basePath, filePath, initialContent = '') {
    const securePath = this.getSecurePath(basePath, filePath);
    try {
      await fs.access(securePath);
      throw new Error('File already exists');
    } catch (e) {
      if (e.message === 'File already exists') throw e;
      await fs.mkdir(path.dirname(securePath), { recursive: true });
      await fs.writeFile(securePath, initialContent, 'utf8');
    }
  }

  static async createFolder(basePath, folderPath) {
    const securePath = this.getSecurePath(basePath, folderPath);
    await fs.mkdir(securePath, { recursive: true });
  }

  static async deleteFile(basePath, filePath) {
    const securePath = this.getSecurePath(basePath, filePath);
    await fs.unlink(securePath);
  }

  static async deleteFolder(basePath, folderPath) {
    const securePath = this.getSecurePath(basePath, folderPath);
    await fs.rm(securePath, { recursive: true, force: true });
  }

  static async rename(basePath, oldPath, newPath) {
    const secureOldPath = this.getSecurePath(basePath, oldPath);
    const secureNewPath = this.getSecurePath(basePath, newPath);
    
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
