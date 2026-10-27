/**
 * DevPilot Desktop Main Process Integration
 * Provides secure native dialogs, IPC handlers, and window management.
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Register secure IPC handlers for native desktop integrations
 */
function setupIpcHandlers() {
  ipcMain.handle('devpilot:select-folder', async (event, initialPath) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const options = {
      title: 'Select Project Workspace Directory',
      properties: ['openDirectory', 'createDirectory']
    };

    if (initialPath && typeof initialPath === 'string') {
      const trimmed = initialPath.trim().replace(/^["']|["']$/g, '');
      if (trimmed && fs.existsSync(trimmed)) {
        options.defaultPath = trimmed;
      }
    }

    try {
      const result = await dialog.showOpenDialog(focusedWindow, options);

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true, cancelled: true, path: null };
      }

      const selectedPath = result.filePaths[0];

      // Validate selected path
      const stats = fs.statSync(selectedPath);
      if (!stats.isDirectory()) {
        return {
          canceled: true,
          cancelled: true,
          path: null,
          error: 'Selected path is not a directory.'
        };
      }

      return {
        canceled: false,
        cancelled: false,
        path: selectedPath,
        folderName: path.basename(selectedPath)
      };
    } catch (err) {
      console.error('[Electron Main] Folder selection error:', err);
      return {
        canceled: true,
        cancelled: true,
        path: null,
        error: err.message || 'Failed to select directory.'
      };
    }
  });

  ipcMain.handle('devpilot:get-platform', () => process.platform);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0d14',
    title: 'DevPilot IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.DEVPILOT_DEV_URL || 'http://localhost:4200';
  win.loadURL(devUrl);
}

if (app) {
  app.whenReady().then(() => {
    setupIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { setupIpcHandlers, createWindow };
