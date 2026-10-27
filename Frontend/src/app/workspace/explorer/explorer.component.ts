import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  computed,
  HostListener,
  ViewChild,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, timeout, finalize } from 'rxjs';
import { ProjectService } from '../../core/services/project.service';
import { FileNode } from '../../shared/models/project.model';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { FileSystemService } from '../../core/services/file-system.service';
import { EditorService } from '../../core/services/editor.service';
import { Router } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { NotificationService } from '../../core/services/notification.service';
import { TerminalService } from '../../core/services/terminal.service';
import { OpenFolderModalComponent } from '../../shared/components/open-folder-modal/open-folder-modal.component';

/** Extended runtime node carrying ephemeral UI state */
export interface ExplorerNode extends FileNode {
  children?: ExplorerNode[];
  _isLoading?: boolean;
}

export type ModalMode = 'new-file' | 'new-folder' | 'rename' | 'delete' | null;

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, SharedIconsModule, OpenFolderModalComponent],
  templateUrl: './explorer.component.html',
  styleUrl: './explorer.component.css'
})
export class ExplorerComponent implements OnInit, OnDestroy {
  private projectService = inject(ProjectService);
  private workspaceService = inject(WorkspaceService);
  private fileSystem = inject(FileSystemService);
  private editorService = inject(EditorService);
  private notificationService = inject(NotificationService);
  private terminalService = inject(TerminalService);
  private router = inject(Router);

  readonly openFolderModalOpen = signal(false);

  openLocalFolder(): void {
    this.openFolderModalOpen.set(true);
  }

  onFolderOpened(project: any): void {
    this.openFolderModalOpen.set(false);
    const targetId = project?.id || project?._id || project?.projectId;
    if (!targetId) return;

    const currentId = this.activeProject()?.id || (this.activeProject() as any)?._id;
    if (currentId === targetId) {
      this.workspaceService.openProject(project);
      this.workspaceService.refreshTree();
      this.notificationService.show(`Workspace "${project.displayName || project.name}" refreshed.`, 'info');
    } else {
      this.router.navigate(['/projects', targetId]);
    }
  }

  private modalSub?: Subscription;
  private unbindDirChanged?: () => void;

  /**
   * Paths currently being refreshed by an explicit user-triggered operation.
   * Prevents launching a duplicate concurrent HTTP refresh for the same
   * directory, and signals WorkspaceService to suppress redundant watcher events.
   */
  private inFlightRefreshPaths = new Set<string>();

  @ViewChild('modalInput') modalInputElement?: ElementRef<HTMLInputElement>;
  @ViewChild('inlineRenameInput') inlineRenameInputElement?: ElementRef<HTMLInputElement>;

  // Cast so that ExplorerNode (with _isLoading and children) is accepted
  readonly files = this.workspaceService.fileTree as unknown as ReturnType<typeof signal<ExplorerNode[]>>;
  readonly selectedFile = signal<string | null>(null);
  readonly isLoading = signal(false);

  // Context Menu State
  readonly contextMenuFile = signal<ExplorerNode | null>(null);
  readonly contextMenuPos = signal({ x: 0, y: 0 });
  readonly contextMenuVisible = signal(false);

  // Inline Rename State
  readonly renamingNode = signal<ExplorerNode | null>(null);
  readonly inlineRenameValue = signal<string>('');

  // Modal Dialog State
  readonly modalMode = signal<ModalMode>(null);
  readonly modalTargetFolder = signal<string>('');
  readonly modalTargetNode = signal<ExplorerNode | null>(null);
  readonly modalInputValue = signal<string>('');
  readonly modalInputError = signal<string | null>(null);
  readonly modalIsSubmitting = signal(false);
  readonly modalErrorMessage = signal<string | null>(null);

  readonly activeProject = this.workspaceService.activeProject;

  readonly localRootName = computed(() => {
    return this.activeProject()?.displayName || this.activeProject()?.name || 'Project';
  });

  readonly hasUnsavedChangesInTarget = computed(() => {
    const node = this.modalTargetNode();
    if (!node) return false;
    if (node.type === 'file') {
      return this.workspaceService.unsavedChanges.has(node.path);
    }
    const prefix = node.path.endsWith('/') ? node.path : node.path + '/';
    return Array.from(this.workspaceService.unsavedChanges).some(
      p => p === node.path || p.startsWith(prefix)
    );
  });

  ngOnInit(): void {
    // Listen for external watcher changes inside expanded subdirectories
    this.unbindDirChanged = this.workspaceService.onDirectoryChanged((dirPath) => {
      const node = this.findNodeByPath(this.files(), dirPath);
      if (node && node.childrenLoaded) {
        this.refreshFolder(dirPath, false);
      }
    });
  }

  ngOnDestroy(): void {
    this.modalSub?.unsubscribe();
    this.unbindDirChanged?.();
  }

  // --------------------------------------------------------------------------
  // Tree Traversal & Helpers
  // --------------------------------------------------------------------------

  removeNodeFromTree(path: string): void {
    const removeFromList = (list: ExplorerNode[]): ExplorerNode[] => {
      return list
        .filter(n => n.path !== path)
        .map(n => {
          if (n.children && n.children.length > 0) {
            return {
              ...n,
              children: removeFromList(n.children)
            };
          }
          return n;
        });
    };

    this.files.update(current => removeFromList(current));
  }

  findNodeByPath(nodes: ExplorerNode[], path: string): ExplorerNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children && node.children.length > 0) {
        const found = this.findNodeByPath(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  getParentPath(path: string): string {
    if (!path) return '';
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : '';
  }

  getAbsoluteLocalPath(relPath: string): string {
    const proj = this.activeProject();
    if (!proj?.localPath) return relPath;
    const cleanRel = relPath ? relPath.split('/').join('\\') : '';
    return cleanRel ? `${proj.localPath}\\${cleanRel}` : proj.localPath;
  }

  /**
   * Immutably updates the node at `targetPath` within the tree by applying
   * `updater`, returning a new array with the change propagated up. Nodes
   * that are not in the changed subtree are returned by reference (no copy).
   *
   * This is the correct way to update nested nodes in the signal-backed tree:
   * direct object mutation followed by `files.update(f => [...f])` does NOT
   * work when any concurrent signal update has already replaced the node
   * object — the mutation lands on a detached reference and is lost.
   */
  private updateNodeInTree(
    nodes: ExplorerNode[],
    targetPath: string,
    updater: (node: ExplorerNode) => ExplorerNode
  ): ExplorerNode[] {
    let changed = false;
    const result = nodes.map(node => {
      if (node.path === targetPath) {
        changed = true;
        return updater(node);
      }
      if (node.children && node.children.length > 0) {
        const updatedChildren = this.updateNodeInTree(node.children, targetPath, updater);
        if (updatedChildren !== node.children) {
          changed = true;
          return { ...node, children: updatedChildren };
        }
      }
      return node;
    });
    return changed ? result : nodes; // Return same reference when nothing changed
  }

  getSiblings(parentPath: string): ExplorerNode[] {
    if (!parentPath) {
      return this.files();
    }
    const parent = this.findNodeByPath(this.files(), parentPath);
    return parent?.children || [];
  }

  // --------------------------------------------------------------------------
  // Live Validation
  // --------------------------------------------------------------------------

  validateName(name: string, parentPath: string, currentOldName: string = ''): string | null {
    if (!name || !name.trim()) {
      return 'Name cannot be empty';
    }
    const trimmed = name.trim();

    if (trimmed.includes('/') || trimmed.includes('\\')) {
      return 'Path separators (/ and \\) are not allowed';
    }

    if (/[<>:"|?*]/.test(trimmed)) {
      return 'Invalid characters: < > : " | ? *';
    }

    if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
      return 'Name cannot end with a period or space';
    }

    const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
    if (reservedRegex.test(trimmed)) {
      return `"${trimmed}" is a reserved Windows device name`;
    }

    if (currentOldName && trimmed.toLowerCase() === currentOldName.toLowerCase()) {
      return null; // Unchanged name is allowed or handled specifically
    }

    const siblings = this.getSiblings(parentPath);
    const conflict = siblings.some(
      s => s.name.toLowerCase() === trimmed.toLowerCase() && s.name.toLowerCase() !== currentOldName.toLowerCase()
    );
    if (conflict) {
      return `An item named "${trimmed}" already exists in this folder`;
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Directory & Tree Refresh
  // --------------------------------------------------------------------------

  refreshAll(): void {
    const proj = this.activeProject();
    if (!proj) return;
    this.workspaceService.refreshTree();
    this.notificationService.show('Explorer refreshed', 'info');
  }

  refreshFolder(folderPath: string, expandAfter: boolean = true): void {
    const proj = this.activeProject();
    if (!proj) return;

    if (!folderPath) {
      this.workspaceService.refreshTree();
      return;
    }

    // Deduplicate: if a refresh for this exact directory is already in-flight,
    // do not start another one. The in-flight request will supply fresh data.
    if (this.inFlightRefreshPaths.has(folderPath)) {
      return;
    }

    // Verify the folder node exists in the current tree; fall back to a full
    // refresh if it was not yet rendered (e.g. parent not yet expanded).
    const folderNodeExists = !!this.findNodeByPath(this.files(), folderPath);
    if (!folderNodeExists) {
      this.workspaceService.refreshTree();
      return;
    }

    // Register with WorkspaceService so the watcher suppresses its own
    // competing refresh for this directory while ours is active.
    this.inFlightRefreshPaths.add(folderPath);
    this.workspaceService.pendingExplicitRefreshPaths.add(folderPath);

    // Mark loading state via immutable update (safe against concurrent signal writes).
    this.files.update(current =>
      this.updateNodeInTree(current, folderPath, n => ({ ...n, _isLoading: true }))
    );

    console.log(`[DIRECTORY REFRESH] projectId=${proj.id} directoryPath=${folderPath}`);

    this.projectService.getDirectoryChildren(proj.id, folderPath).subscribe({
      next: (children: FileNode[]) => {
        // Verify the project hasn't switched during the async call.
        if (this.activeProject()?.id !== proj.id) return;

        console.log(`[DIRECTORY RESULT] path=${folderPath} entryCount=${children.length}`);

        // Immutable path-keyed update — correct even if concurrent signal updates
        // have replaced the original node object reference captured above.
        this.files.update(current =>
          this.updateNodeInTree(current, folderPath, n => ({
            ...n,
            children: children as ExplorerNode[],
            childrenLoaded: true,
            _isLoading: false,
            ...(expandAfter ? { isOpen: true } : {}),
          }))
        );

        console.log(`[EXPLORER STATE UPDATE] parentNodeFound=true childrenUpdated=${children.length} expandAfter=${expandAfter}`);
      },
      error: (err) => {
        console.error(`[DIRECTORY REFRESH ERROR] path=${folderPath}:`, err);
        this.files.update(current =>
          this.updateNodeInTree(current, folderPath, n => ({ ...n, _isLoading: false }))
        );
      },
      complete: () => {
        // Always clean up regardless of success or error.
        this.inFlightRefreshPaths.delete(folderPath);
        this.workspaceService.pendingExplicitRefreshPaths.delete(folderPath);
      }
    });
  }


  // --------------------------------------------------------------------------
  // Folder Expansion & File Selection
  // --------------------------------------------------------------------------

  async toggleFolder(node: ExplorerNode): Promise<void> {
    if (node._isLoading) return;

    // Capture stable identifiers before any async gap.
    const folderPath = node.path;
    const isOpening = !node.isOpen;
    const alreadyLoaded = !!node.childrenLoaded;
    const proj = this.activeProject();

    // Flip the open/close flag immediately via an immutable path-keyed update.
    // Using updateNodeInTree guarantees we always operate on the current signal
    // state, not a potentially stale captured node reference.
    this.files.update(current =>
      this.updateNodeInTree(current, folderPath, n => ({ ...n, isOpen: isOpening }))
    );

    if (isOpening && !alreadyLoaded) {
      if (!proj) return;

      // Mark loading state.
      this.files.update(current =>
        this.updateNodeInTree(current, folderPath, n => ({ ...n, _isLoading: true }))
      );

      console.log(`[DIRECTORY REFRESH] projectId=${proj.id} directoryPath=${folderPath}`);

      this.projectService.getDirectoryChildren(proj.id, folderPath).subscribe({
        next: (children: FileNode[]) => {
          console.log(`[DIRECTORY RESULT] path=${folderPath} entryCount=${children.length}`);
          // Immutable update: works correctly even if the node was replaced
          // by a concurrent refreshTree() / mergeTreeNodes() call.
          this.files.update(current =>
            this.updateNodeInTree(current, folderPath, n => ({
              ...n,
              children: children as ExplorerNode[],
              childrenLoaded: true,
              _isLoading: false,
            }))
          );
        },
        error: (err) => {
          console.error(`Failed to load children for "${folderPath}":`, err);
          this.files.update(current =>
            this.updateNodeInTree(current, folderPath, n => ({
              ...n,
              isOpen: false,
              _isLoading: false,
            }))
          );
        }
      });
    }
  }


  selectFile(node: ExplorerNode): void {
    if (this.renamingNode() === node) return;

    if (node.type === 'folder') {
      this.selectedFile.set(node.path);
      this.toggleFolder(node);
    } else {
      this.selectedFile.set(node.path);
      this.editorService.openFile(node);
    }
  }

  // --------------------------------------------------------------------------
  // Context Menu Management
  // --------------------------------------------------------------------------

  onContextMenu(e: MouseEvent, node: ExplorerNode | null = null): void {
    e.preventDefault();
    e.stopPropagation();

    // Close any active inline rename cleanly
    if (this.renamingNode()) {
      this.cancelInlineRename();
    }

    this.contextMenuFile.set(node);
    if (node) {
      this.selectedFile.set(node.path);
    }

    // Boundary clamping to avoid overflowing window edges
    const menuWidth = 190;
    const menuHeight = node ? (node.type === 'folder' ? 240 : 200) : 130;
    const x = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth - 10));
    const y = Math.max(10, Math.min(e.clientY, window.innerHeight - menuHeight - 10));

    this.contextMenuPos.set({ x, y });
    this.contextMenuVisible.set(true);
  }

  closeContextMenu(): void {
    this.contextMenuVisible.set(false);
  }

  openFileFromContext(node: ExplorerNode): void {
    this.closeContextMenu();
    this.selectFile(node);
  }

  copyPath(node: ExplorerNode | null): void {
    this.closeContextMenu();
    const relPath = node ? node.path : '';
    const absPath = this.getAbsoluteLocalPath(relPath);
    try {
      navigator.clipboard?.writeText(absPath);
      this.notificationService.show('Path copied to clipboard', 'info');
    } catch (_) {}
  }

  copyRelativePath(node: ExplorerNode | null): void {
    this.closeContextMenu();
    const relPath = node ? node.path : '';
    try {
      navigator.clipboard?.writeText(relPath);
      this.notificationService.show('Relative path copied to clipboard', 'info');
    } catch (_) {}
  }

  openInTerminal(node: ExplorerNode | null): void {
    this.closeContextMenu();
    const relPath = node ? (node.type === 'folder' ? node.path : this.getParentPath(node.path)) : '';
    const absPath = this.getAbsoluteLocalPath(relPath);
    this.terminalService.cdToDirectory(absPath);
    this.notificationService.show(`Terminal directory set to ${node ? node.name : 'project root'}`, 'info');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.contextMenuVisible()) {
      this.closeContextMenu();
    }
  }

  // --------------------------------------------------------------------------
  // Keyboard Shortcuts
  // --------------------------------------------------------------------------

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent): void {
    // If inside a modal dialog, handle Escape to cancel and Enter to submit
    if (this.modalMode()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!this.modalIsSubmitting()) {
          this.closeModal();
        }
      } else if (event.key === 'Enter' && this.modalMode() === 'delete') {
        event.preventDefault();
        if (!this.modalIsSubmitting()) {
          this.submitModal();
        }
      }
      return;
    }

    // If context menu is visible, close on Escape
    if (this.contextMenuVisible() && event.key === 'Escape') {
      event.preventDefault();
      this.closeContextMenu();
      return;
    }

    // If currently inline renaming, let the input handler process it
    if (this.renamingNode()) return;

    // Do not intercept if active element is Monaco or an input/textarea
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('.monaco-editor') || target.closest('.ngx-monaco-editor'))) {
      return;
    }

    const selectedPath = this.selectedFile();
    const node = selectedPath ? this.findNodeByPath(this.files(), selectedPath) : null;

    if (event.key === 'F2' && node) {
      event.preventDefault();
      this.startInlineRename(node);
    } else if (event.key === 'Delete' && node) {
      event.preventDefault();
      this.openDeleteDialog(node);
    } else if (event.key === 'Enter' && node) {
      event.preventDefault();
      this.selectFile(node);
    }
  }

  // --------------------------------------------------------------------------
  // Inline Renaming
  // --------------------------------------------------------------------------

  startInlineRename(node: ExplorerNode): void {
    this.closeContextMenu();
    this.renamingNode.set(node);
    this.inlineRenameValue.set(node.name);

    setTimeout(() => {
      const input = this.inlineRenameInputElement?.nativeElement;
      if (input) {
        input.focus();
        if (node.type === 'file' && node.name.includes('.')) {
          const lastDot = node.name.lastIndexOf('.');
          input.setSelectionRange(0, lastDot > 0 ? lastDot : node.name.length);
        } else {
          input.select();
        }
      }
    }, 20);
  }

  commitInlineRename(node: ExplorerNode, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const proj = this.activeProject();
    if (!proj) {
      this.renamingNode.set(null);
      return;
    }

    const newName = this.inlineRenameValue().trim();
    if (!newName || newName === node.name) {
      this.renamingNode.set(null);
      return;
    }

    const parentPath = this.getParentPath(node.path);
    const error = this.validateName(newName, parentPath, node.name);
    if (error) {
      this.notificationService.show(error, 'error');
      // Keep focus on input for correction
      setTimeout(() => this.inlineRenameInputElement?.nativeElement?.focus(), 10);
      return;
    }

    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    const oldPath = node.path;
    const isFolder = node.type === 'folder';

    this.fileSystem.renamePath(proj.id, oldPath, newPath).subscribe({
      next: () => {
        this.renamingNode.set(null);
        if (isFolder) {
          this.editorService.handleFolderRenamed(oldPath, newPath);
        } else {
          this.editorService.handleFileRenamed(oldPath, newPath, newName);
        }

        // Refresh parent folder or tree
        this.refreshFolder(parentPath, false);
        this.selectedFile.set(newPath);
        this.notificationService.show(`Renamed to "${newName}"`, 'success');
      },
      error: (err) => {
        const msg = err.error?.message || err.message || 'Failed to rename';
        this.notificationService.show(msg, 'error');
        this.renamingNode.set(null);
      }
    });
  }

  cancelInlineRename(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.renamingNode.set(null);
  }

  onInlineRenameBlur(node: ExplorerNode): void {
    if (this.renamingNode() === node) {
      const val = this.inlineRenameValue().trim();
      if (val && val !== node.name) {
        this.commitInlineRename(node);
      } else {
        this.cancelInlineRename();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Custom Modal Dialog Management
  // --------------------------------------------------------------------------

  openNewFileDialog(targetNode: ExplorerNode | null = null): void {
    this.closeContextMenu();
    if (this.modalIsSubmitting()) return;

    this.modalSub?.unsubscribe();
    const folder = targetNode
      ? (targetNode.type === 'folder' ? targetNode.path : this.getParentPath(targetNode.path))
      : (this.contextMenuFile()?.type === 'folder' ? this.contextMenuFile()!.path : '');

    this.modalMode.set('new-file');
    this.modalTargetFolder.set(folder);
    this.modalTargetNode.set(targetNode);
    this.modalInputValue.set('');
    this.modalInputError.set(null);
    this.modalErrorMessage.set(null);
    this.modalIsSubmitting.set(false);

    setTimeout(() => this.modalInputElement?.nativeElement?.focus(), 50);
  }

  openNewFolderDialog(targetNode: ExplorerNode | null = null): void {
    this.closeContextMenu();
    if (this.modalIsSubmitting()) return;

    this.modalSub?.unsubscribe();
    const folder = targetNode
      ? (targetNode.type === 'folder' ? targetNode.path : this.getParentPath(targetNode.path))
      : (this.contextMenuFile()?.type === 'folder' ? this.contextMenuFile()!.path : '');

    this.modalMode.set('new-folder');
    this.modalTargetFolder.set(folder);
    this.modalTargetNode.set(targetNode);
    this.modalInputValue.set('');
    this.modalInputError.set(null);
    this.modalErrorMessage.set(null);
    this.modalIsSubmitting.set(false);

    setTimeout(() => this.modalInputElement?.nativeElement?.focus(), 50);
  }

  openDeleteDialog(node: ExplorerNode): void {
    this.closeContextMenu();

    if (this.modalIsSubmitting()) return;

    if (!node || !node.path || node.path === '.' || node.path === '/' || node.path === '\\') {
      this.notificationService.show('Cannot delete project root', 'error');
      return;
    }

    this.modalSub?.unsubscribe();
    this.modalMode.set('delete');
    this.modalTargetNode.set(node);
    this.modalErrorMessage.set(null);
    this.modalInputValue.set('');
    this.modalInputError.set(null);
    this.modalIsSubmitting.set(false);
  }

  closeModal(force = false): void {
    if (!force && this.modalIsSubmitting()) return;
    this.modalSub?.unsubscribe();
    this.modalMode.set(null);
    this.modalTargetNode.set(null);
    this.modalTargetFolder.set('');
    this.modalInputValue.set('');
    this.modalInputError.set(null);
    this.modalErrorMessage.set(null);
    this.modalIsSubmitting.set(false);
  }

  onModalInputChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.modalInputValue.set(val);
    this.modalErrorMessage.set(null);

    const mode = this.modalMode();
    if (mode === 'new-file' || mode === 'new-folder') {
      const err = this.validateName(val, this.modalTargetFolder());
      this.modalInputError.set(err);
    } else if (mode === 'rename') {
      const node = this.modalTargetNode();
      const parent = node ? this.getParentPath(node.path) : '';
      const err = this.validateName(val, parent, node?.name || '');
      this.modalInputError.set(err);
    }
  }

  submitModal(): void {
    const mode = this.modalMode();
    const proj = this.activeProject();
    if (!mode || !proj || this.modalIsSubmitting()) return;

    if (mode === 'new-file') {
      const name = this.modalInputValue().trim();
      const parent = this.modalTargetFolder();
      const validation = this.validateName(name, parent);
      if (validation) {
        this.modalInputError.set(validation);
        return;
      }

      const fullPath = parent ? `${parent}/${name}` : name;
      this.modalIsSubmitting.set(true);
      this.modalErrorMessage.set(null);

      this.modalSub = this.fileSystem.createFile(proj.id, fullPath).pipe(
        timeout(15000),
        finalize(() => this.modalIsSubmitting.set(false))
      ).subscribe({
        next: () => {
          this.closeModal(true);
          this.refreshFolder(parent, true);

          // Automatically open newly created file in Monaco
          const ext = name.includes('.') ? name.split('.').pop() || 'txt' : 'txt';
          const newNode: ExplorerNode = {
            name,
            path: fullPath,
            type: 'file',
            extension: ext
          };
          this.selectedFile.set(fullPath);
          this.editorService.openFile(newNode);
          this.notificationService.show(`Created file "${name}"`, 'success');
        },
        error: (err) => {
          const msg = this.sanitizeErrorMessage(err, 'file', 'create');
          this.modalErrorMessage.set(msg);
        }
      });

    } else if (mode === 'new-folder') {
      const name = this.modalInputValue().trim();
      const parent = this.modalTargetFolder();
      const validation = this.validateName(name, parent);
      if (validation) {
        this.modalInputError.set(validation);
        return;
      }

      const fullPath = parent ? `${parent}/${name}` : name;
      this.modalIsSubmitting.set(true);
      this.modalErrorMessage.set(null);

      this.modalSub = this.fileSystem.createFolder(proj.id, fullPath).pipe(
        timeout(15000),
        finalize(() => this.modalIsSubmitting.set(false))
      ).subscribe({
        next: () => {
          this.closeModal(true);
          this.refreshFolder(parent, true);
          this.notificationService.show(`Created folder "${name}"`, 'success');
        },
        error: (err) => {
          const msg = this.sanitizeErrorMessage(err, 'folder', 'create');
          this.modalErrorMessage.set(msg);
        }
      });

    } else if (mode === 'delete') {
      const node = this.modalTargetNode();
      if (!node) return;

      this.modalIsSubmitting.set(true);
      this.modalErrorMessage.set(null);
      const isFolder = node.type === 'folder';
      const itemType = isFolder ? 'folder' : 'file';

      this.modalSub = this.fileSystem.deletePath(proj.id, node.path, isFolder).pipe(
        timeout(15000),
        finalize(() => {
          this.modalIsSubmitting.set(false);
        })
      ).subscribe({
        next: () => {
          // 1. Close modal after confirmed deletion
          this.closeModal(true);

          // 2. Remove node from local Explorer tree
          this.removeNodeFromTree(node.path);

          // 3. Close open tabs in Monaco and clean up workspace state
          if (isFolder) {
            this.editorService.handleFolderDeleted(node.path);
          } else {
            this.editorService.handleFileDeleted(node.path);
          }

          // 4. Clear active selection if the deleted item was selected
          const sel = this.selectedFile();
          if (sel) {
            if (isFolder && (sel === node.path || sel.startsWith(node.path + '/'))) {
              this.selectedFile.set(null);
            } else if (!isFolder && sel === node.path) {
              this.selectedFile.set(null);
            }
          }

          // 5. Refresh the affected Explorer directory
          const parent = this.getParentPath(node.path);
          this.refreshFolder(parent, false);

          // 6. User feedback toast
          this.notificationService.show(`Deleted "${node.name}"`, 'success');
        },
        error: (err) => {
          // Modal remains open, loading state reset by finalize(), show safe error
          const msg = this.sanitizeErrorMessage(err, itemType, 'delete');
          this.modalErrorMessage.set(msg);
        }
      });
    }
  }

  private sanitizeErrorMessage(err: any, itemType: 'file' | 'folder', operation: 'delete' | 'create' = 'delete'): string {
    const defaultMsg = operation === 'delete'
      ? `Unable to delete this ${itemType}. Please try again.`
      : `Unable to create this ${itemType}. Please try again.`;

    if (!err) return defaultMsg;

    if (err.name === 'TimeoutError' || err.message?.includes('Timeout') || err.message?.includes('timeout')) {
      return `The operation timed out. Please try again.`;
    }

    if (err.status === 0) {
      return `Unable to connect to server. Please check your connection and try again.`;
    }

    const raw = typeof err.error?.message === 'string'
      ? err.error.message
      : (typeof err.message === 'string' ? err.message : '');

    if (!raw) return defaultMsg;

    const lower = raw.toLowerCase();

    if (lower.includes('root')) {
      return `Cannot delete the project root directory.`;
    }
    if (lower.includes('not found') || lower.includes('enoent') || err.status === 404) {
      return `The ${itemType} could not be found. It may have already been removed.`;
    }
    if (lower.includes('permission denied') || lower.includes('eacces') || lower.includes('eperm') || err.status === 403) {
      return `Permission denied. Unable to delete this ${itemType}.`;
    }
    if (lower.includes('busy') || lower.includes('locked') || lower.includes('ebusy') || err.status === 409) {
      return `This ${itemType} is currently in use or locked by another process.`;
    }
    if (lower.includes('security exception') || lower.includes('traversal')) {
      return `Invalid path traversal detected.`;
    }

    // Check if raw message contains filesystem paths or stack trace markers
    if (raw.includes('\\') || raw.includes('/') || raw.includes('node:') || raw.includes('at ') || raw.includes('Http failure')) {
      return defaultMsg;
    }

    // If message is clean, safe and short, show it
    if (raw.length < 80 && !/[<>{}]/.test(raw)) {
      return raw;
    }

    return defaultMsg;
  }

  // --------------------------------------------------------------------------
  // Icons
  // --------------------------------------------------------------------------

  getFileIcon(node: ExplorerNode): string {
    if (node.type === 'folder') {
      if (node._isLoading) return 'loader';
      return node.isOpen ? 'folder-open' : 'folder';
    }
    const ext = node.extension?.toLowerCase() || '';
    const icons: Record<string, string> = {
      ts: 'code-2',
      js: 'file-code-2',
      json: 'file-json',
      md: 'file-text',
      css: 'palette',
      html: 'globe',
      env: 'lock',
      txt: 'file-text',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      svg: 'palette'
    };
    return icons[ext] || 'file';
  }
}
