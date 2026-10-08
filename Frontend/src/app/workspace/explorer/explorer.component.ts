import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { FileNode } from '../../shared/models/project.model';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { FileSystemService } from '../../core/services/file-system.service';
import { EditorService } from '../../core/services/editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';

/** Extended runtime node — carries ephemeral UI state not persisted to the server. */
interface ExplorerNode extends FileNode {
  children?: ExplorerNode[];
  /** True while the children HTTP request for this node is in-flight. */
  _isLoading?: boolean;
}

@Component({
  selector: 'app-explorer',
  standalone: true,
  imports: [CommonModule, SharedIconsModule],
  templateUrl: './explorer.component.html',
  styleUrl: './explorer.component.css'
})
export class ExplorerComponent implements OnInit {
  private projectService = inject(ProjectService);
  private router = inject(Router);
  private workspaceService = inject(WorkspaceService);
  private fileSystem = inject(FileSystemService);
  private editorService = inject(EditorService);

  // Cast so that ExplorerNode (with _isLoading) is accepted throughout this component.
  readonly files = this.workspaceService.fileTree as unknown as ReturnType<typeof signal<ExplorerNode[]>>;
  readonly selectedFile = signal<string | null>(null);
  readonly contextMenuFile = signal<ExplorerNode | null>(null);
  readonly contextMenuPos = signal({ x: 0, y: 0 });
  readonly isLoading = signal(false);

  readonly activeProject = this.workspaceService.activeProject;

  readonly localRootName = computed(() => {
    return this.activeProject()?.name || 'Project';
  });

  ngOnInit(): void {
    // The WorkspaceService manages fetching the shallow file tree automatically.
  }

  /**
   * Toggle a folder open/closed.
   *
   * First expand: fetches immediate children lazily via GET /files/children.
   * Subsequent expands: already-loaded children are rendered instantly with no network call.
   */
  async toggleFolder(node: ExplorerNode): Promise<void> {
    if (node._isLoading) return; // guard against double-click during an in-flight fetch

    const isOpening = !node.isOpen;
    node.isOpen = isOpening;

    if (isOpening && !node.childrenLoaded) {
      // ── First expand ─────────────────────────────────────────────────────────
      const proj = this.activeProject();
      if (!proj) {
        this.files.update(f => [...f]);
        return;
      }

      const t0 = performance.now();
      console.log(`[PERF][Explorer] T0 expand "${node.path}" — fetching children`);

      node._isLoading = true;
      this.files.update(f => [...f]); // show spinner in icon before network call

      this.projectService.getDirectoryChildren(proj.id, node.path).subscribe({
        next: (children: FileNode[]) => {
          node.children = children as ExplorerNode[];
          node.childrenLoaded = true;
          node._isLoading = false;
          console.log(
            `[PERF][Explorer] T1 "${node.path}" children ready ` +
            `${(performance.now() - t0).toFixed(1)}ms (${children.length} items)`
          );
          this.files.update(f => [...f]);
        },
        error: (err) => {
          node._isLoading = false;
          node.isOpen = false; // revert: don't show an empty folder
          console.error(`[Explorer] Failed to load children for "${node.path}":`, err);
          this.files.update(f => [...f]);
        }
      });
    } else {
      // ── Subsequent toggles ────────────────────────────────────────────────────
      // Children already loaded; just flip visibility — zero network cost.
      this.files.update(f => [...f]);
    }
  }

  selectFile(node: ExplorerNode): void {
    if (node.type === 'folder') {
      this.toggleFolder(node);
    } else {
      this.selectedFile.set(node.path);
      this.editorService.openFile(node);
    }
  }

  async createNewFile(): Promise<void> {
    const proj = this.activeProject();
    if (!proj) return alert('No active project');
    const name = prompt('Enter new file name:');
    if (!name) return;

    // Default to root if no folder selected
    const parentPath = this.contextMenuFile()?.type === 'folder' ? this.contextMenuFile()?.path : '';
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    try {
      this.fileSystem.createFile(proj.id, fullPath).subscribe({
        next: () => this.closeContextMenu(),
        error: (err) => alert('Failed to create file: ' + err.message)
      });
    } catch (err) { alert('Failed to create file'); }
  }

  async createNewFolder(): Promise<void> {
    const proj = this.activeProject();
    if (!proj) return alert('No active project');
    const name = prompt('Enter new folder name:');
    if (!name) return;

    const parentPath = this.contextMenuFile()?.type === 'folder' ? this.contextMenuFile()?.path : '';
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    try {
      this.fileSystem.createFolder(proj.id, fullPath).subscribe({
        next: () => this.closeContextMenu(),
        error: (err) => alert('Failed to create folder: ' + err.message)
      });
    } catch (err) { alert('Failed to create folder'); }
  }

  onContextMenu(e: MouseEvent, node: ExplorerNode | null = null): void {
    e.preventDefault();
    this.contextMenuFile.set(node);
    this.contextMenuPos.set({ x: e.clientX, y: e.clientY });
  }

  closeContextMenu(): void {
    this.contextMenuFile.set(null);
  }

  async deleteContextNode(): Promise<void> {
    const node = this.contextMenuFile();
    const proj = this.activeProject();
    if (!node || !proj) return;

    const confirmDelete = confirm(`Are you sure you want to delete ${node.name}?`);
    if (!confirmDelete) return;

    this.fileSystem.deletePath(proj.id, node.path, node.type === 'folder').subscribe({
      next: () => this.closeContextMenu(),
      error: (err) => alert('Failed to delete: ' + err.message)
    });
  }

  getFileIcon(node: ExplorerNode): string {
    if (node.type === 'folder') {
      if (node._isLoading) return 'loader';          // spinner while fetching children
      return node.isOpen ? 'folder-open' : 'folder';
    }
    const ext = node.extension?.toLowerCase() || '';
    const icons: Record<string, string> = {
      ts: 'code-2', js: 'file-code-2', json: 'file-json', md: 'file-text', css: 'palette',
      html: 'globe', env: 'lock', txt: 'file-text', png: 'image', jpg: 'image'
    };
    return icons[ext] || 'file';
  }
}
