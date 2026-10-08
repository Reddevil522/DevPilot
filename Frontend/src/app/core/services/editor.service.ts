import { Injectable, signal, computed, inject } from '@angular/core';
import { FileNode } from '../../shared/models/project.model';
import { WorkspaceService } from './workspace.service';

export interface EditorTab {
  name: string;
  path: string;
  extension: string;
  dirty: boolean;
  active: boolean;
  content: string;
  node: FileNode;
}

@Injectable({ providedIn: 'root' })
export class EditorService {
  private workspaceService = inject(WorkspaceService);

  readonly tabs = signal<EditorTab[]>([]);
  readonly activeTab = computed(() => this.tabs().find(t => t.active));

  constructor() {
    // Sync external file updates from WorkspaceService to EditorTabs
    // Actually, Angular effects cannot easily trigger state changes like this without a cycle, 
    // but we can listen or just let the user re-open.
    // WorkspaceService is updating fileContents Map. 
    // We should probably rely on EditorService state as the single source of truth for open editors.
  }

  async openFile(node: FileNode): Promise<void> {
    if (node.type !== 'file') return;
    
    // Check if already open
    const currentTabs = this.tabs();
    const existingIdx = currentTabs.findIndex(t => t.path === node.path);
    
    if (existingIdx !== -1) {
      this.setActiveTab(node.path);
      return;
    }

    try {
      // Ensure file content is loaded in WorkspaceService
      await this.workspaceService.loadFileContent(node.path);
      
      const content = this.workspaceService.fileContents.get(node.path) || '';
      
      this.tabs.update(tabs => {
        const newTabs = tabs.map(t => ({ ...t, active: false }));
        newTabs.push({
          name: node.name,
          path: node.path,
          extension: node.extension || '',
          dirty: false,
          active: true,
          content: content,
          node: node
        });
        return newTabs;
      });
      
      // Sync with WorkspaceService
      this.workspaceService.openFiles.set(this.tabs().map(t => t.node));
      
    } catch (err) {
      console.error('Failed to open file', err);
      alert('Failed to open file. See console for details.');
    }
  }

  setActiveTab(path: string): void {
    this.tabs.update(tabs => tabs.map(t => ({ ...t, active: t.path === path })));
    const active = this.activeTab();
    if (active) {
      this.workspaceService.activeFile.set(active.node);
    }
  }

  closeTab(path: string): boolean {
    const tabToClose = this.tabs().find(t => t.path === path);
    if (!tabToClose) return true;

    if (tabToClose.dirty) {
      const confirmSave = confirm(`You have unsaved changes in ${tabToClose.name}. Save changes before closing?`);
      if (confirmSave) {
        this.saveTab(tabToClose);
      }
    }

    this.tabs.update(tabs => {
      const idx = tabs.findIndex(t => t.path === path);
      const updated = tabs.filter(t => t.path !== path);
      if (tabToClose.active && updated.length > 0) {
        updated[Math.max(0, idx - 1)].active = true;
      }
      return updated;
    });

    this.workspaceService.closeFileByPath(path);
    
    const active = this.activeTab();
    if (active) {
      this.workspaceService.activeFile.set(active.node);
    } else {
      this.workspaceService.activeFile.set(null);
    }

    return true;
  }

  updateContent(path: string, newContent: string): void {
    this.tabs.update(tabs => {
      const idx = tabs.findIndex(t => t.path === path);
      if (idx === -1) return tabs;
      const t = tabs[idx];
      if (t.content === newContent) return tabs;
      
      const newTabs = [...tabs];
      newTabs[idx] = { ...t, content: newContent, dirty: true };
      
      // Update workspace service unsaved changes tracking
      this.workspaceService.unsavedChanges.add(path);
      
      return newTabs;
    });
  }

  async saveTab(tab: EditorTab): Promise<void> {
    if (!tab.dirty) return;
    
    try {
      await this.workspaceService.saveFile(tab.path, tab.content);
      
      this.tabs.update(tabs => {
        const idx = tabs.findIndex(t => t.path === tab.path);
        if (idx === -1) return tabs;
        const newTabs = [...tabs];
        newTabs[idx] = { ...newTabs[idx], dirty: false };
        return newTabs;
      });
      // Optionally notify "Saved"
    } catch (err) {
      console.error('Failed to save file', err);
    }
  }

  async saveActiveTab(): Promise<void> {
    const active = this.activeTab();
    if (active) {
      await this.saveTab(active);
    }
  }
}
