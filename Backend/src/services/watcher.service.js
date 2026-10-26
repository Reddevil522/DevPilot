const chokidar = require('chokidar');
const EventEmitter = require('events');
const path = require('path');

class WatcherService extends EventEmitter {
  constructor() {
    super();
    // Map of normalizedProjectRoot -> { watcher, projectRoot, refCount }
    this.watchers = new Map();
    
    // Ignore rules standard for DevPilot
    this.ignored = [
      /(^|[\/\\])\../, // ignore dotfiles/dotfolders
      /node_modules/,
      /dist/,
      /build/
    ];
  }

  normalizeRoot(rootPath) {
    if (!rootPath) return '';
    return path.resolve(rootPath).toLowerCase();
  }

  watch(projectRoot) {
    if (!projectRoot) return;
    const normRoot = this.normalizeRoot(projectRoot);
    const existing = this.watchers.get(normRoot);

    if (existing) {
      existing.refCount++;
      return;
    }

    console.log(`[Watcher] Starting watcher for: ${projectRoot}`);

    const watcher = chokidar.watch(projectRoot, {
      ignored: this.ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    watcher
      .on('add', filePath => this.emitEvent('CREATE', projectRoot, filePath))
      .on('change', filePath => this.emitEvent('UPDATE', projectRoot, filePath))
      .on('unlink', filePath => this.emitEvent('DELETE', projectRoot, filePath))
      .on('addDir', dirPath => this.emitEvent('CREATE_FOLDER', projectRoot, dirPath))
      .on('unlinkDir', dirPath => this.emitEvent('DELETE_FOLDER', projectRoot, dirPath))
      .on('error', error => console.error(`[Watcher] Error (${projectRoot}): ${error}`));

    this.watchers.set(normRoot, { watcher, projectRoot, refCount: 1 });
  }

  emitEvent(type, projectRoot, fullPath) {
    const relativePath = path.relative(projectRoot, fullPath);
    // Standardize to forward slashes for the frontend
    const standardizedPath = relativePath.split(path.sep).join('/');
    
    this.emit('file-event', {
      type,
      path: standardizedPath,
      projectRoot: this.normalizeRoot(projectRoot),
      timestamp: Date.now()
    });
  }

  async unwatch(projectRoot) {
    if (!projectRoot) return;
    const normRoot = this.normalizeRoot(projectRoot);
    const entry = this.watchers.get(normRoot);
    if (!entry) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      console.log(`[Watcher] Stopping watcher for: ${projectRoot}`);
      this.watchers.delete(normRoot);
      try {
        await entry.watcher.close();
      } catch (err) {
        console.warn(`[Watcher] Error closing watcher for ${projectRoot}:`, err);
      }
    }
  }

  async stop() {
    await this.stopAll();
  }

  async stopAll() {
    for (const [normRoot, entry] of this.watchers.entries()) {
      try {
        await entry.watcher.close();
      } catch (_) {}
    }
    this.watchers.clear();
  }
}

// Export as singleton
module.exports = new WatcherService();
