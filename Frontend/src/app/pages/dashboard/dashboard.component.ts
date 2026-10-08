import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { AuthService } from '../../core/services/auth.service';
import { Project } from '../../shared/models/project.model';
import { CreateProjectModalComponent } from '../../shared/components/create-project-modal/create-project-modal.component';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CreateProjectModalComponent, SharedIconsModule],
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
  readonly createModalOpen = signal(false);
  readonly projectToDelete = signal<Project | null>(null);
  
  readonly stats = computed(() => {
    const projs = this.projects();
    return {
      total: projs.length,
      active: projs.filter(p => p.status === 'active').length,
      deployments: projs.filter(p => !!p.deploymentUrl).length,
      aiTasks: 0 // Real AI tasks data not available yet
    };
  });

  readonly greeting = this.getGreeting();

  ngOnInit(): void {
    this.projectService.getProjects().subscribe((p) => this.projects.set(p));
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  openProject(project: Project): void {
    this.projectService.setActiveProject(project);
    this.router.navigate(['/projects', project.id]);
  }

  onProjectCreated(project: Project): void {
    this.projects.update(projs => [project, ...projs]);
    this.router.navigate(['/projects', project.id]);
    this.createModalOpen.set(false);
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
        this.notifService.show(`Project "${project.name}" deleted successfully.`, 'success');
        this.projectToDelete.set(null);
      },
      error: (err) => {
        if (err.status === 404) {
          // Project was already deleted from backend — remove from local UI list
          this.projects.update(projs => projs.filter(p => p.id !== project.id));
          this.notifService.show(`Project "${project.name}" removed.`, 'info');
        } else {
          this.notifService.show(`Failed to delete project: ${err.error?.message || err.message}`, 'error');
        }
        this.projectToDelete.set(null);
      }
    });
  }

  getRelativeTime(dateInput: Date | string): string {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (!date || isNaN(date.getTime())) return 'Recently';
    
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${Math.max(1, mins)} min ago`;
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
