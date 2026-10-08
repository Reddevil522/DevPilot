import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { FileNode } from '../../shared/models/project.model';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { FileSystemService } from '../../core/services/file-system.service';
import { EditorService } from '../../core/services/editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';

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

  readonly files = this.workspaceService.fileTree;
  readonly selectedFile = signal<string | null>(null);
  readonly contextMenuFile = signal<FileNode | null>(null);
  readonly contextMenuPos = signal({ x: 0, y: 0 });
  readonly isLoading = signal(false);

  readonly activeProject = this.workspaceService.activeProject;
  
  readonly localRootName = computed(() => {
    return this.activeProject()?.name || 'Project';
  });

  ngOnInit(): void {
    // The WorkspaceService manages fetching the file tree automatically
  }

  async toggleFolder(node: FileNode): Promise<void> {
    node.isOpen = !node.isOpen;
    this.files.update((f) => [...f]);
  }

  selectFile(node: FileNode): void {
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

  onContextMenu(e: MouseEvent, node: FileNode | null = null): void {
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

  getFileIcon(node: FileNode): string {
    if (node.type === 'folder') return node.isOpen ? 'folder-open' : 'folder';
    const ext = node.extension?.toLowerCase() || '';
    const icons: Record<string, string> = {
      ts: 'code-2', js: 'file-code-2', json: 'file-json', md: 'file-text', css: 'palette',
      html: 'globe', env: 'lock', txt: 'file-text', png: 'image', jpg: 'image'
    };
    return icons[ext] || 'file';
  }
}
