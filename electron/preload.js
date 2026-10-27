/**
 * DevPilot Desktop Preload Script
 * Exposes a secure, context-isolated bridge for native desktop capabilities.
 * Strictly avoids exposing unrestricted Node.js APIs to the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Opens the native OS directory selection dialog via Electron main process.
   * Returns { canceled: boolean, path: string | null, folderName?: string }
   */
  selectFolder: (initialPath) => ipcRenderer.invoke('devpilot:select-folder', initialPath),

  /**
   * Returns current OS platform ('win32', 'darwin', 'linux')
   */
  getPlatform: () => ipcRenderer.invoke('devpilot:get-platform'),

  /**
   * Desktop runtime indicator flag
   */
  isDesktop: true
});
