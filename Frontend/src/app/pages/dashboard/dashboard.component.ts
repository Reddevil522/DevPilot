import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { AuthService } from '../../core/services/auth.service';
import { Project } from '../../shared/models/project.model';
import { CreateProjectModalComponent } from '../../shared/components/create-project-modal/create-project-modal.component';
import { OpenFolderModalComponent } from '../../shared/components/open-folder-modal/open-folder-modal.component';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, CreateProjectModalComponent, OpenFolderModalComponent, SharedIconsModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private projectService = inject(ProjectService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private notifService = inject(NotificationService);

  readonly user = this.authService.currentUser;
  readonly projects = signal<Project[]>([]);
  readonly isLoading = this.projectService.isLoading;
  readonly errorMessage = signal<string | null>(null);

  readonly createModalOpen = signal(false);
  readonly openFolderModalOpen = signal(false);
  readonly projectToDelete = signal<Project | null>(null);
  readonly projectToEdit = signal<Project | null>(null);
  readonly inaccessibleProject = signal<Project | null>(null);

  readonly isCheckingPath = signal(false);
  readonly isEditing = signal(false);

  // Edit form state
  readonly editDisplayName = signal('');
  readonly editDescription = signal('');
  readonly editGitRepo = signal('');
  readonly editGitBranch = signal('main');
  readonly editStatus = signal<'active' | 'inactive' | 'archived'>('active');

  private currentGeneration = 0;
  private inFlightRequest = false;

  readonly stats = computed(() => {
    const projs = this.projects();
    return {
      total: projs.length,
      active: projs.filter(p => p.status === 'active').length,
      deployments: projs.filter(p => !!p.deploymentUrl).length,
      local: projs.filter(p => p.projectType === 'local').length,
      aiTasks: 0
    };
  });

  readonly greeting = this.getGreeting();

  ngOnInit(): void {
    this.loadProjects();
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  /**
   * Fetch authenticated user's projects from MongoDB API.
   * Handles request deduplication, generation tracking, and error reporting.
   */
  loadProjects(force = false): void {
    if (this.inFlightRequest && !force) return;

    this.inFlightRequest = true;
    this.errorMessage.set(null);
    const gen = ++this.currentGeneration;

    this.projectService.getProjects().subscribe({
      next: (list) => {
        if (gen < this.currentGeneration) return; // Discard stale response
        const deduped = this.deduplicateProjects(list);
        // Sort by lastOpenedAt (descending), fallback to updatedAt
        deduped.sort((a, b) => {
          const timeA = new Date(a.lastOpenedAt || a.updatedAt || a.createdAt).getTime();
          const timeB = new Date(b.lastOpenedAt || b.updatedAt || b.createdAt).getTime();
          return timeB - timeA;
        });
        this.projects.set(deduped);
        this.inFlightRequest = false;
      },
      error: (err) => {
        if (gen < this.currentGeneration) return;
        this.inFlightRequest = false;
        if (err.status === 401) {
          this.errorMessage.set('Your session has expired. Please log in again.');
        } else {
          this.errorMessage.set(
            err.error?.message || 'Failed to load projects. Please verify the backend server is reachable.'
          );
        }
      }
    });
  }

  /**
   * Open the selected project.
   * If local workspace path is missing/inaccessible, presents a recovery modal.
   */
  openProject(project: Project): void {
    if (project.isAccessible === false) {
      this.inaccessibleProject.set(project);
      return;
    }

    // Refresh lastOpenedAt in background
    this.projectService.updateLastOpened(project.id).subscribe({
      error: (err) => console.warn('[Dashboard] Could not update lastOpenedAt:', err)
    });

    this.projectService.setActiveProject(project);
    this.router.navigate(['/projects', project.id]);
  }

  /**
   * Recovery Action 1: Re-validate inaccessible local path
   */
  retryInaccessibleCheck(): void {
    const p = this.inaccessibleProject();
    if (!p || !p.localPath) return;

    this.isCheckingPath.set(true);
    this.projectService.validateWorkspacePath(p.localPath).subscribe({
      next: (res) => {
        this.isCheckingPath.set(false);
        if (res.accessible) {
          this.notifService.show('Workspace folder verified! Opening project...', 'success');
          // Update in local state
          this.projects.update(list =>
            list.map(item => item.id === p.id ? { ...item, isAccessible: true } : item)
          );
          const updatedProj = { ...p, isAccessible: true };
          this.inaccessibleProject.set(null);
          this.openProject(updatedProj);
        } else {
          this.notifService.show(`Directory is still inaccessible on disk: ${p.localPath}`, 'error');
        }
      },
      error: () => {
        this.isCheckingPath.set(false);
        this.notifService.show('Failed to validate directory path.', 'error');
      }
    });
  }

  /**
   * Recovery Action 2: Relocate workspace to a new folder on disk
   */
  async relocateInaccessibleProject(): Promise<void> {
    const p = this.inaccessibleProject();
    if (!p) return;

    try {
      const selected = await this.projectService.selectFolder(p.localPath);
      if (!selected) return;

      this.projectService.updateProject(p.id, { localPath: selected }).subscribe({
        next: (updated) => {
          this.projects.update(list =>
            list.map(item => item.id === p.id ? { ...item, ...updated, isAccessible: true } : item)
          );
          this.notifService.show(`Workspace relocated to "${selected}". Opening project...`, 'success');
          this.inaccessibleProject.set(null);
          this.openProject({ ...p, ...updated, isAccessible: true });
        },
        error: (err) => {
          this.notifService.show(`Failed to relocate workspace: ${err.error?.message || err.message}`, 'error');
        }
      });
    } catch (err) {
      console.error('[Dashboard] Relocate failed:', err);
    }
  }

  /**
   * Recovery Action 3: Unlink missing workspace metadata from DevPilot
   */
  unlinkInaccessibleProject(): void {
    const p = this.inaccessibleProject();
    if (!p) return;

    this.projectService.deleteProject(p.id, false).subscribe({
      next: () => {
        this.projects.update(list => list.filter(item => item.id !== p.id));
        this.notifService.show(`Project "${p.displayName || p.name}" removed from DevPilot.`, 'info');
        this.inaccessibleProject.set(null);
      },
      error: (err) => {
        this.notifService.show(`Failed to unlink project: ${err.error?.message || err.message}`, 'error');
      }
    });
  }

  closeInaccessibleModal(): void {
    this.inaccessibleProject.set(null);
  }

  /**
   * Edit permitted project metadata
   */
  openEditModal(project: Project, event: Event): void {
    event.stopPropagation();
    this.projectToEdit.set(project);
    this.editDisplayName.set(project.displayName || project.name);
    this.editDescription.set(project.description || '');
    this.editGitRepo.set(project.gitRepo || '');
    this.editGitBranch.set(project.gitBranch || 'main');
    this.editStatus.set((project.status as any) || 'active');
  }

  closeEditModal(): void {
    this.projectToEdit.set(null);
  }

  saveEdit(): void {
    const p = this.projectToEdit();
    if (!p) return;

    const trimmedName = this.editDisplayName().trim();
    if (!trimmedName) {
      this.notifService.show('Display name cannot be empty.', 'error');
      return;
    }

    this.isEditing.set(true);
    const updates: Partial<Project> = {
      displayName: trimmedName,
      description: this.editDescription().trim(),
      gitRepo: this.editGitRepo().trim(),
      gitBranch: this.editGitBranch().trim(),
      status: this.editStatus()
    };

    this.projectService.updateProject(p.id, updates).subscribe({
      next: (updated) => {
        this.isEditing.set(false);
        this.projects.update(list =>
          list.map(item => item.id === p.id ? { ...item, ...updated } : item)
        );
        this.notifService.show(`Project "${updated.displayName || updated.name}" updated successfully.`, 'success');
        this.closeEditModal();
      },
      error: (err) => {
        this.isEditing.set(false);
        this.notifService.show(`Failed to update project: ${err.error?.message || err.message}`, 'error');
      }
    });
  }

  openLocalFolder(): void {
    this.openFolderModalOpen.set(true);
  }

  onProjectCreated(project: Project): void {
    const targetId = project?.id || (project as any)?._id || (project as any)?.projectId;
    this.projects.update(projs => this.deduplicateProjects([project, ...projs]));
    this.createModalOpen.set(false);
    this.openFolderModalOpen.set(false);
    if (targetId) {
      this.router.navigate(['/projects', targetId]);
    }
  }

  deleteProject(project: Project, event: Event): void {
    event.stopPropagation();
    this.projectToDelete.set(project);
  }

  cancelDelete(): void {
    this.projectToDelete.set(null);
  }

  confirmDelete(): void {
    const project = this.projectToDelete();
    if (!project) return;

    this.projectService.deleteProject(project.id).subscribe({
      next: () => {
        this.projects.update(projs => projs.filter(p => p.id !== project.id));
        this.notifService.show(`Project "${project.displayName || project.name}" removed successfully.`, 'success');
        this.projectToDelete.set(null);
      },
      error: (err) => {
        if (err.status === 404) {
          this.projects.update(projs => projs.filter(p => p.id !== project.id));
          this.notifService.show(`Project "${project.displayName || project.name}" removed.`, 'info');
        } else {
          this.notifService.show(`Failed to delete project: ${err.error?.message || err.message}`, 'error');
        }
        this.projectToDelete.set(null);
      }
    });
  }

  private deduplicateProjects(list: Project[]): Project[] {
    const seen = new Set<string>();
    return list.filter(p => {
      const key = p.id || (p as any)._id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getRelativeTime(dateInput: Date | string): string {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (!date || isNaN(date.getTime())) return 'Recently';

    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${Math.max(1, mins)}m ago`;
  }

  getTechIcon(tech: string): string {
    const icons: Record<string, string> = {
      angular: 'layers', react: 'cpu', nodejs: 'server',
      express: 'rocket', fullstack: 'zap', custom: 'settings'
    };
    return icons[tech] || 'code-2';
  }

  getStatusClass(status: string): string {
    return status === 'active' ? 'devpilot-dashboard__status--active' : 'devpilot-dashboard__status--inactive';
  }
}

