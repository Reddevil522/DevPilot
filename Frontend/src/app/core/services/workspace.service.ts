import { Injectable, signal, inject } from '@angular/core';
import { Project, FileNode } from '../../shared/models/project.model';
import { FileSystemService, FileEvent } from './file-system.service';
import { ProjectService } from './project.service';
import { Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private fileSystem = inject(FileSystemService);
  private projectService = inject(ProjectService);

  readonly activeProject = signal<Project | null>(null);
  readonly fileTree = signal<FileNode[]>([]);
  readonly openFiles = signal<FileNode[]>([]);
  readonly activeFile = signal<FileNode | null>(null);
  
  readonly fileContents = new Map<string, string>(); 
  readonly unsavedChanges = new Set<string>(); 

  private watcherSub?: Subscription;

  openProject(project: Project) {
    this.closeProject();
    this.activeProject.set(project);

    this.projectService.getProjectFiles(project.id).subscribe(tree => {
      this.fileTree.set(tree);
      this.startWatcher(project.id);
    });
  }

  closeProject() {
    this.activeProject.set(null);
    this.fileTree.set([]);
    this.openFiles.set([]);
    this.activeFile.set(null);
    this.fileContents.clear();
    this.unsavedChanges.clear();
    if (this.watcherSub) {
      this.watcherSub.unsubscribe();
      this.watcherSub = undefined;
    }
  }

  private startWatcher(projectId: string) {
    this.watcherSub = this.fileSystem.watchProject(projectId).subscribe({
      next: (event) => this.handleWatcherEvent(event),
      error: (err) => console.error('Watcher error:', err)
    });
  }

  private handleWatcherEvent(event: FileEvent) {
    if (event.type === 'CREATE' || event.type === 'DELETE' || event.type === 'CREATE_FOLDER' || event.type === 'DELETE_FOLDER') {
      const proj = this.activeProject();
      if (proj) {
         this.projectService.getProjectFiles(proj.id).subscribe(tree => {
            this.fileTree.set(tree);
         });
      }
    }
    
    if (event.type === 'UPDATE' && event.path) {
      if (this.unsavedChanges.has(event.path)) {
        console.warn(`[Workspace] File ${event.path} changed on disk but has unsaved changes in DevPilot.`);
        alert(`File ${event.path} changed on disk but has unsaved changes. Please review or save.`);
      } else {
        if (this.fileContents.has(event.path)) {
          this.loadFileContent(event.path, true);
        }
      }
    }
    
    if (event.type === 'DELETE' && event.path) {
       this.closeFileByPath(event.path);
    }
  }

  closeFileByPath(path: string) {
    const current = this.openFiles();
    const updated = current.filter(f => f.path !== path);
    this.openFiles.set(updated);
    this.fileContents.delete(path);
    this.unsavedChanges.delete(path);
    
    if (this.activeFile()?.path === path) {
       this.activeFile.set(updated.length > 0 ? updated[0] : null);
    }
  }

  async loadFileContent(path: string, forceReload = false) {
     const proj = this.activeProject();
     if (!proj) return;
     if (!forceReload && this.fileContents.has(path)) {
        return;
     }
     
     this.fileSystem.readFile(proj.id, path).subscribe({
       next: (content) => {
         this.fileContents.set(path, content);
         this.activeFile.set({...this.activeFile()!} as FileNode); // trigger reactivity
       },
       error: (err) => alert('Failed to read file: ' + err.message)
     });
  }

  async saveFile(path: string, content: string) {
     const proj = this.activeProject();
     if (!proj) return;
     
     return new Promise<void>((resolve, reject) => {
       this.fileSystem.writeFile(proj.id, path, content).subscribe({
         next: () => {
           this.fileContents.set(path, content);
           this.unsavedChanges.delete(path);
           resolve();
         },
         error: (err) => {
           alert('Failed to save file: ' + err.message);
           reject(err);
         }
       });
     });
  }
}
