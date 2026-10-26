import { Injectable, signal, computed, inject } from '@angular/core';
import { FileNode } from '../../shared/models/project.model';
import { WorkspaceService } from './workspace.service';
import { NotificationService } from './notification.service';

export interface EditorTab {
  name: string;
  path: string;
  extension: string;
  dirty: boolean;
  active: boolean;
  content: string;
  savedContent: string;
  node: FileNode;
}

@Injectable({ providedIn: 'root' })
export class EditorService {
  private workspaceService = inject(WorkspaceService);
  private notificationService = inject(NotificationService);

  readonly tabs = signal<EditorTab[]>([]);
  readonly activeTab = computed(() => this.tabs().find(t => t.active));

  /** Callbacks for external editor cleanup (e.g. Monaco model disposal) */
  private tabClosedCallbacks = new Set<(path: string) => void>();
  private tabRenamedCallbacks = new Set<(oldPath: string, newPath: string) => void>();
  private tabExternalUpdateCallbacks = new Set<(path: string, content: string) => void>();

  constructor() {
    // When project closes, close all open editor tabs and dispose models
    this.workspaceService.onProjectClosed(() => {
      this.closeAllTabs();
    });

    // When a file or folder is deleted on disk externally (e.g. via terminal), close tab safely
    this.workspaceService.onFileDeleted((path) => {
      this.handleFileDeleted(path);
      this.handleFolderDeleted(path);
    });

    // When an open file is updated on disk externally (e.g. via terminal), update editor
    this.workspaceService.onFileUpdated((path, content) => {
      this.handleExternalFileUpdated(path, content);
    });
  }

  onTabClosed(cb: (path: string) => void): () => void {
    this.tabClosedCallbacks.add(cb);
    return () => this.tabClosedCallbacks.delete(cb);
  }

  onTabRenamed(cb: (oldPath: string, newPath: string) => void): () => void {
    this.tabRenamedCallbacks.add(cb);
    return () => this.tabRenamedCallbacks.delete(cb);
  }

  onTabExternalUpdated(cb: (path: string, content: string) => void): () => void {
    this.tabExternalUpdateCallbacks.add(cb);
    return () => this.tabExternalUpdateCallbacks.delete(cb);
  }

  handleExternalFileUpdated(path: string, freshContent: string): void {
    const normalized = this.normalizePath(path);
    const tab = this.tabs().find(t => t.path === normalized);
    if (tab && tab.dirty) {
      // User has unsaved edits in editor; avoid silently overwriting unsaved content
      return;
    }

    this.tabs.update(tabs => tabs.map(t => {
      if (t.path === normalized) {
        return {
          ...t,
          content: freshContent,
          savedContent: freshContent
        };
      }
      return t;
    }));

    this.tabExternalUpdateCallbacks.forEach(cb => {
      try { cb(normalized, freshContent); } catch (_) {}
    });
  }

  private normalizePath(p: string): string {
    return (p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  async openFile(node: FileNode): Promise<void> {
    if (node.type !== 'file') return;
    const normalizedPath = this.normalizePath(node.path);

    // Check if already open
    const currentTabs = this.tabs();
    const existingIdx = currentTabs.findIndex(t => t.path === normalizedPath);

    if (existingIdx !== -1) {
      this.setActiveTab(normalizedPath);
      return;
    }

    try {
      // Await real file content from disk via WorkspaceService
      const content = await this.workspaceService.loadFileContent(normalizedPath);

      const ext = node.extension || (node.name.includes('.') ? node.name.split('.').pop() || '' : '');

      this.tabs.update(tabs => {
        const newTabs = tabs.map(t => ({ ...t, active: false }));
        newTabs.push({
          name: node.name,
          path: normalizedPath,
          extension: ext,
          dirty: false,
          active: true,
          content: content,
          savedContent: content,
          node: { ...node, path: normalizedPath }
        });
        return newTabs;
      });

      // Sync with WorkspaceService
      this.workspaceService.openFiles.set(this.tabs().map(t => t.node));
      const active = this.activeTab();
      if (active) {
        this.workspaceService.activeFile.set(active.node);
      }
    } catch (err) {
      console.error('[EditorService] Failed to open file:', err);
      // loadFileContent already displays user notification
    }
  }

  setActiveTab(path: string): void {
    const normalized = this.normalizePath(path);
    this.tabs.update(tabs => tabs.map(t => ({ ...t, active: t.path === normalized })));
    const active = this.activeTab();
    if (active) {
      this.workspaceService.activeFile.set(active.node);
    }
  }

  updateContent(path: string, newContent: string): void {
    const normalized = this.normalizePath(path);
    this.tabs.update(tabs => {
      const idx = tabs.findIndex(t => t.path === normalized);
      if (idx === -1) return tabs;
      const t = tabs[idx];
      if (t.content === newContent) return tabs;

      const isDirty = newContent !== t.savedContent;
      const newTabs = [...tabs];
      newTabs[idx] = { ...t, content: newContent, dirty: isDirty };

      // Update workspace unsaved changes set
      if (isDirty) {
        this.workspaceService.unsavedChanges.add(normalized);
      } else {
        this.workspaceService.unsavedChanges.delete(normalized);
      }

      return newTabs;
    });
  }

  async saveTab(tab: EditorTab): Promise<boolean> {
    if (!tab.dirty) return true;

    try {
      await this.workspaceService.saveFile(tab.path, tab.content);

      this.tabs.update(tabs => {
        const idx = tabs.findIndex(t => t.path === tab.path);
        if (idx === -1) return tabs;
        const newTabs = [...tabs];
        newTabs[idx] = {
          ...newTabs[idx],
          savedContent: tab.content,
          dirty: false
        };
        return newTabs;
      });

      this.workspaceService.unsavedChanges.delete(tab.path);
      this.notificationService.show(`Saved ${tab.name}`, 'info');
      return true;
    } catch (err: any) {
      console.error('[EditorService] Failed to save file:', err);
      return false;
    }
  }

  async saveActiveTab(): Promise<boolean> {
    const active = this.activeTab();
    if (active) {
      return await this.saveTab(active);
    }
    return false;
  }

  async closeTab(path: string, force = false): Promise<boolean> {
    const normalized = this.normalizePath(path);
    const tabToClose = this.tabs().find(t => t.path === normalized);
    if (!tabToClose) return true;

    if (tabToClose.dirty && !force) {
      const shouldSave = confirm(`"${tabToClose.name}" has unsaved changes.\n\nClick OK to save before closing, or Cancel to keep editing.`);
      if (shouldSave) {
        const saved = await this.saveTab(tabToClose);
        if (!saved) {
          // If save failed, do not close the tab!
          return false;
        }
      } else {
        // Cancel close
        return false;
      }
    }

    // Clean up Monaco model
    this.tabClosedCallbacks.forEach(cb => {
      try { cb(normalized); } catch (_) {}
    });

    this.workspaceService.unsavedChanges.delete(normalized);

    this.tabs.update(tabs => {
      const idx = tabs.findIndex(t => t.path === normalized);
      const updated = tabs.filter(t => t.path !== normalized);
      if (tabToClose.active && updated.length > 0) {
        updated[Math.max(0, idx - 1)].active = true;
      }
      return updated;
    });

    this.workspaceService.closeFileByPath(normalized);

    const active = this.activeTab();
    if (active) {
      this.workspaceService.activeFile.set(active.node);
    } else {
      this.workspaceService.activeFile.set(null);
    }

    return true;
  }

  handleFileRenamed(oldPath: string, newPath: string, newName: string): void {
    const oldNorm = this.normalizePath(oldPath);
    const newNorm = this.normalizePath(newPath);
    const ext = newName.includes('.') ? newName.split('.').pop() || 'txt' : 'txt';

    this.tabs.update(tabs => tabs.map(t => {
      if (t.path === oldNorm) {
        return {
          ...t,
          name: newName,
          path: newNorm,
          extension: ext,
          node: { ...t.node, name: newName, path: newNorm, extension: ext }
        };
      }
      return t;
    }));

    this.tabRenamedCallbacks.forEach(cb => {
      try { cb(oldNorm, newNorm); } catch (_) {}
    });

    this.workspaceService.handleFileRenamed(oldNorm, newNorm, newName);
  }

  handleFolderRenamed(oldFolderPath: string, newFolderPath: string): void {
    const oldNorm = this.normalizePath(oldFolderPath);
    const newNorm = this.normalizePath(newFolderPath);
    const oldPrefix = oldNorm.endsWith('/') ? oldNorm : oldNorm + '/';
    const newPrefix = newNorm.endsWith('/') ? newNorm : newNorm + '/';

    this.tabs.update(tabs => tabs.map(t => {
      if (t.path.startsWith(oldPrefix)) {
        const subPath = t.path.slice(oldPrefix.length);
        const renamedPath = newPrefix + subPath;
        this.tabRenamedCallbacks.forEach(cb => {
          try { cb(t.path, renamedPath); } catch (_) {}
        });
        return {
          ...t,
          path: renamedPath,
          node: { ...t.node, path: renamedPath }
        };
      }
      return t;
    }));

    this.workspaceService.handleFolderRenamed(oldNorm, newNorm);
  }

  handleFileDeleted(path: string): void {
    const normalized = this.normalizePath(path);
    // Force close without prompting
    this.closeTab(normalized, true);
  }

  handleFolderDeleted(folderPath: string): void {
    const normalized = this.normalizePath(folderPath);
    const prefix = normalized.endsWith('/') ? normalized : normalized + '/';

    const childTabs = this.tabs().filter(t => t.path === normalized || t.path.startsWith(prefix));
    for (const child of childTabs) {
      this.closeTab(child.path, true);
    }
    this.workspaceService.handleFolderDeleted(normalized);
  }

  closeAllTabs(): void {
    for (const tab of this.tabs()) {
      this.tabClosedCallbacks.forEach(cb => {
        try { cb(tab.path); } catch (_) {}
      });
    }
    this.tabs.set([]);
    this.workspaceService.openFiles.set([]);
    this.workspaceService.activeFile.set(null);
    this.workspaceService.unsavedChanges.clear();
  }
}
