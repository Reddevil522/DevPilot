import { Injectable, signal, inject } from '@angular/core';
import { Project, FileNode } from '../../shared/models/project.model';
import { FileSystemService, FileEvent } from './file-system.service';
import { ProjectService } from './project.service';
import { NotificationService } from './notification.service';
import { Subscription, firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private fileSystem = inject(FileSystemService);
  private projectService = inject(ProjectService);
  private notificationService = inject(NotificationService);

  readonly activeProject = signal<Project | null>(null);
  readonly fileTree = signal<FileNode[]>([]);
  readonly openFiles = signal<FileNode[]>([]);
  readonly activeFile = signal<FileNode | null>(null);
  
  readonly fileContents = new Map<string, string>(); 
  readonly unsavedChanges = new Set<string>(); 

  private projectClosedCallbacks = new Set<() => void>();
  private fileUpdatedCallbacks = new Set<(path: string, content: string) => void>();
  private fileDeletedCallbacks = new Set<(path: string) => void>();
  private directoryChangedCallbacks = new Set<(dirPath: string) => void>();

  onProjectClosed(cb: () => void): () => void {
    this.projectClosedCallbacks.add(cb);
    return () => this.projectClosedCallbacks.delete(cb);
  }

  onFileUpdated(cb: (path: string, content: string) => void): () => void {
    this.fileUpdatedCallbacks.add(cb);
    return () => this.fileUpdatedCallbacks.delete(cb);
  }

  onFileDeleted(cb: (path: string) => void): () => void {
    this.fileDeletedCallbacks.add(cb);
    return () => this.fileDeletedCallbacks.delete(cb);
  }

  onDirectoryChanged(cb: (dirPath: string) => void): () => void {
    this.directoryChangedCallbacks.add(cb);
    return () => this.directoryChangedCallbacks.delete(cb);
  }

  private watcherSub?: Subscription;

  /**
   * Monotonically increasing counter used to detect and discard stale
   * full-tree HTTP responses that arrive after a newer refresh has started.
   */
  private refreshGeneration = 0;

  /**
   * Normalized parent-directory paths for which a targeted directory refresh
   * is already in-flight, triggered explicitly by a user file operation.
   * When the watcher emits an event for the same parent directory the
   * redundant full-tree refresh is skipped to avoid a conflicting update.
   */
  readonly pendingExplicitRefreshPaths = new Set<string>();

  /**
   * Debounce timer handles keyed by parent-directory path.
   * Coalesces rapid successive watcher events for the same directory
   * into a single refresh 300 ms after the last event.
   */
  private watcherDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  openProject(project: Project) {
    this.closeProject();
    this.activeProject.set(project);

    // Kick off file tree loading and watcher concurrently
    this.refreshTree();
    this.startWatcher(project.id);
  }

  /**
   * Full-tree refresh.  Preserves the isOpen / childrenLoaded state of
   * nodes that already exist in the current tree so folders do not
   * unexpectedly collapse after a refresh.
   */
  refreshTree(): void {
    const proj = this.activeProject();
    if (!proj) return;

    // Capture a generation token so stale responses are silently discarded.
    const gen = ++this.refreshGeneration;

    this.projectService.getProjectFiles(proj.id).subscribe({
      next: (freshTree) => {
        // Discard if a newer refresh has already started.
        if (gen < this.refreshGeneration) return;

        // Merge the fresh top-level list while preserving expanded state.
        const merged = this.mergeTreeNodes(freshTree, this.fileTree());
        this.fileTree.set(merged);
      },
      error: (err) => {
        // On error keep the last known-good tree – do not blank it out.
        console.error('[WorkspaceService] refreshTree failed:', err);
      }
    });
  }

  closeProject() {
    this.activeProject.set(null);
    this.fileTree.set([]);
    this.openFiles.set([]);
    this.activeFile.set(null);
    this.fileContents.clear();
    this.unsavedChanges.clear();
    this.pendingExplicitRefreshPaths.clear();

    // Cancel all pending watcher debounce timers.
    for (const timer of this.watcherDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.watcherDebounceTimers.clear();

    if (this.watcherSub) {
      this.watcherSub.unsubscribe();
      this.watcherSub = undefined;
    }

    this.projectClosedCallbacks.forEach(cb => {
      try { cb(); } catch (_) {}
    });
  }

  private startWatcher(projectId: string) {
    this.watcherSub = this.fileSystem.watchProject(projectId).subscribe({
      next: (event) => this.handleWatcherEvent(event),
      error: (err) => console.error('Watcher error:', err)
    });
  }

  private handleWatcherEvent(event: FileEvent) {
    if (event.type === 'CREATE' || event.type === 'DELETE' ||
        event.type === 'CREATE_FOLDER' || event.type === 'DELETE_FOLDER') {

      // Determine the parent directory that this event affects.
      const affectedParent = event.path ? this.getParentPath(event.path) : '';

      // If an explicit (user-initiated) refresh for this exact parent is
      // already in-flight, this watcher event is redundant – skip it.
      if (this.pendingExplicitRefreshPaths.has(affectedParent)) {
        return;
      }

      // Coalesce rapid successive events for the same parent directory.
      const existing = this.watcherDebounceTimers.get(affectedParent);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        this.watcherDebounceTimers.delete(affectedParent);

        // Re-check in case an explicit refresh was registered in the meantime.
        if (this.pendingExplicitRefreshPaths.has(affectedParent)) {
          return;
        }

        if (affectedParent) {
          this.directoryChangedCallbacks.forEach(cb => {
            try { cb(affectedParent); } catch (_) {}
          });
        }
        this.refreshTree();
      }, 300);

      this.watcherDebounceTimers.set(affectedParent, timer);
    }
    
    if (event.type === 'UPDATE' && event.path) {
      const normPath = event.path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (this.unsavedChanges.has(normPath)) {
        console.warn(`[Workspace] File ${normPath} changed on disk but has unsaved changes in DevPilot.`);
        this.notificationService.show(`File "${normPath}" was modified externally, but has unsaved editor changes. Save to overwrite or reload tab.`, 'info');
      } else {
        this.loadFileContent(normPath, true).then(freshContent => {
          this.fileUpdatedCallbacks.forEach(cb => {
            try { cb(normPath, freshContent); } catch (_) {}
          });
        }).catch(() => {});
      }
    }
    
    if ((event.type === 'DELETE' || event.type === 'DELETE_FOLDER') && event.path) {
      const normPath = event.path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (event.type === 'DELETE_FOLDER') {
        this.handleFolderDeleted(normPath);
      } else {
        this.handleFileDeleted(normPath);
      }
      this.fileDeletedCallbacks.forEach(cb => {
        try { cb(normPath); } catch (_) {}
      });
    }
  }

  handleFileRenamed(oldPath: string, newPath: string, newName: string): void {
    if (this.fileContents.has(oldPath)) {
      const content = this.fileContents.get(oldPath)!;
      this.fileContents.delete(oldPath);
      this.fileContents.set(newPath, content);
    }
    if (this.unsavedChanges.has(oldPath)) {
      this.unsavedChanges.delete(oldPath);
      this.unsavedChanges.add(newPath);
    }
    const currentOpen = this.openFiles();
    const updatedOpen = currentOpen.map(f => {
      if (f.path === oldPath) {
        return {
          ...f,
          name: newName,
          path: newPath,
          extension: newName.includes('.') ? newName.split('.').pop() || 'txt' : 'txt'
        };
      }
      return f;
    });
    this.openFiles.set(updatedOpen);

    const active = this.activeFile();
    if (active && active.path === oldPath) {
      this.activeFile.set({
        ...active,
        name: newName,
        path: newPath,
        extension: newName.includes('.') ? newName.split('.').pop() || 'txt' : 'txt'
      });
    }
  }

  handleFolderRenamed(oldFolderPath: string, newFolderPath: string): void {
    const oldPrefix = oldFolderPath.endsWith('/') ? oldFolderPath : oldFolderPath + '/';
    const newPrefix = newFolderPath.endsWith('/') ? newFolderPath : newFolderPath + '/';

    for (const [key, val] of Array.from(this.fileContents.entries())) {
      if (key.startsWith(oldPrefix)) {
        const newKey = newPrefix + key.slice(oldPrefix.length);
        this.fileContents.delete(key);
        this.fileContents.set(newKey, val);
      }
    }

    for (const key of Array.from(this.unsavedChanges)) {
      if (key.startsWith(oldPrefix)) {
        const newKey = newPrefix + key.slice(oldPrefix.length);
        this.unsavedChanges.delete(key);
        this.unsavedChanges.add(newKey);
      }
    }

    const currentOpen = this.openFiles();
    const updatedOpen = currentOpen.map(f => {
      if (f.path.startsWith(oldPrefix)) {
        const newPath = newPrefix + f.path.slice(oldPrefix.length);
        return { ...f, path: newPath };
      }
      return f;
    });
    this.openFiles.set(updatedOpen);

    const active = this.activeFile();
    if (active && active.path.startsWith(oldPrefix)) {
      const newPath = newPrefix + active.path.slice(oldPrefix.length);
      this.activeFile.set({ ...active, path: newPath });
    }
  }

  handleFileDeleted(path: string): void {
    this.unsavedChanges.delete(path);
    this.fileContents.delete(path);
    const updated = this.openFiles().filter(f => f.path !== path);
    this.openFiles.set(updated);
    if (this.activeFile()?.path === path) {
      this.activeFile.set(updated.length > 0 ? updated[0] : null);
    }
  }

  handleFolderDeleted(folderPath: string): void {
    const prefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';
    for (const key of Array.from(this.unsavedChanges)) {
      if (key === folderPath || key.startsWith(prefix)) {
        this.unsavedChanges.delete(key);
      }
    }
    for (const key of Array.from(this.fileContents.keys())) {
      if (key === folderPath || key.startsWith(prefix)) {
        this.fileContents.delete(key);
      }
    }
    const updated = this.openFiles().filter(f => f.path !== folderPath && !f.path.startsWith(prefix));
    this.openFiles.set(updated);
    if (this.activeFile() && (this.activeFile()!.path === folderPath || this.activeFile()!.path.startsWith(prefix))) {
      this.activeFile.set(updated.length > 0 ? updated[0] : null);
    }
  }

  closeFileByPath(path: string): void {
    this.handleFileDeleted(path);
  }

  async loadFileContent(path: string, forceReload = false): Promise<string> {
    const proj = this.activeProject();
    if (!proj) return '';
    if (!forceReload && this.fileContents.has(path)) {
      return this.fileContents.get(path)!;
    }
    
    try {
      const content = await firstValueFrom(this.fileSystem.readFile(proj.id, path));
      this.fileContents.set(path, content);
      const cur = this.activeFile();
      if (cur) {
        this.activeFile.set({ ...cur });
      }
      return content;
    } catch (err: any) {
      console.error('[WorkspaceService] Failed to read file:', err);
      this.notificationService.show('Failed to read file: ' + (err.error?.message || err.message), 'error');
      throw err;
    }
  }

  async saveFile(path: string, content: string): Promise<void> {
    const proj = this.activeProject();
    if (!proj) return;
    
    try {
      await firstValueFrom(this.fileSystem.writeFile(proj.id, path, content));
      this.fileContents.set(path, content);
      this.unsavedChanges.delete(path);
    } catch (err: any) {
      this.notificationService.show('Failed to save file: ' + (err.error?.message || err.message), 'error');
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Returns the parent directory path of a file/folder path.
   * "src/app/foo.ts" → "src/app"
   * "foo.ts"          → ""
   */
  private getParentPath(path: string): string {
    if (!path) return '';
    const normalized = path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
  }

  /**
   * Recursively merge a freshly-fetched list of FileNodes into the existing
   * tree, preserving isOpen, childrenLoaded, and already-loaded children
   * for nodes that have not changed.
   *
   * - New nodes in `fresh` that don't exist in `existing` are added as-is.
   * - Nodes in `existing` absent from `fresh` are removed (deleted files).
   * - Nodes present in both: isOpen/childrenLoaded are preserved, children
   *   are recursively merged if the existing node already loaded them.
   */
  private mergeTreeNodes(fresh: FileNode[], existing: FileNode[]): FileNode[] {
    const existingByPath = new Map<string, FileNode>();
    for (const node of existing) {
      existingByPath.set(node.path, node);
    }

    return fresh.map(freshNode => {
      const existingNode = existingByPath.get(freshNode.path);
      if (!existingNode) {
        return freshNode; // Brand-new node – use as-is.
      }

      const merged: FileNode = {
        ...freshNode,
        isOpen: existingNode.isOpen,
        childrenLoaded: existingNode.childrenLoaded,
      };

      if (freshNode.type === 'folder' && existingNode.childrenLoaded && existingNode.children) {
        if (freshNode.childrenLoaded) {
          // Server actually loaded and returned children in this response; recursively merge them.
          merged.children = this.mergeTreeNodes(freshNode.children || [], existingNode.children);
        } else {
          // getProjectFiles() and shallow responses return folders with childrenLoaded = false
          // and an empty children: [] array. Retain the existing loaded children instead.
          merged.children = existingNode.children;
        }
      }

      return merged;
    });
  }
}
