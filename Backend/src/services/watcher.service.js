const chokidar = require('chokidar');
const EventEmitter = require('events');
const path = require('path');

class WatcherService extends EventEmitter {
  constructor() {
    super();
    this.watcher = null;
    this.currentProjectRoot = null;
    
    // Ignore rules standard for DevPilot
    this.ignored = [
      /(^|[\/\\])\../, // ignore dotfiles/dotfolders
      /node_modules/,
      /dist/,
      /build/
    ];
  }

  watch(projectRoot) {
    if (this.currentProjectRoot === projectRoot) return;

    this.stop();
    this.currentProjectRoot = projectRoot;
    console.log(`[Watcher] Starting watcher for: ${projectRoot}`);

    this.watcher = chokidar.watch(projectRoot, {
      ignored: this.ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', filePath => this.emitEvent('CREATE', filePath))
      .on('change', filePath => this.emitEvent('UPDATE', filePath))
      .on('unlink', filePath => this.emitEvent('DELETE', filePath))
      .on('addDir', dirPath => this.emitEvent('CREATE_FOLDER', dirPath))
      .on('unlinkDir', dirPath => this.emitEvent('DELETE_FOLDER', dirPath))
      .on('error', error => console.error(`[Watcher] Error: ${error}`));
  }

  emitEvent(type, fullPath) {
    if (!this.currentProjectRoot) return;
    const relativePath = path.relative(this.currentProjectRoot, fullPath);
    // Standardize to forward slashes for the frontend
    const standardizedPath = relativePath.split(path.sep).join('/');
    
    this.emit('file-event', {
      type,
      path: standardizedPath,
      timestamp: Date.now()
    });
  }

  stop() {
    if (this.watcher) {
      console.log(`[Watcher] Stopping watcher for: ${this.currentProjectRoot}`);
      this.watcher.close();
      this.watcher = null;
      this.currentProjectRoot = null;
    }
  }
}

// Export as singleton
module.exports = new WatcherService();
