import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeploymentService } from '../../core/services/deployment.service';
import { ProjectService } from '../../core/services/project.service';
import { Deployment } from '../../shared/models/deployment.model';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

@Component({
  selector: 'app-deployments',
  standalone: true,
  imports: [CommonModule, SharedIconsModule],
  templateUrl: './deployments.component.html',
  styleUrl: './deployments.component.css'
})
export class DeploymentsComponent implements OnInit {
  private deploymentService = inject(DeploymentService);
  private projectService = inject(ProjectService);
  private notifService = inject(NotificationService);

  readonly deployments = signal<Deployment[]>([]);
  readonly isLoading = signal(true);
  readonly isDeploying = this.deploymentService.isDeploying;

  ngOnInit(): void {
    const project = this.projectService.activeProject();
    if (project) {
      this.deploymentService.getDeployments(project.id).subscribe((d) => {
        this.deployments.set(d);
        this.isLoading.set(false);
      });
    } else {
      this.isLoading.set(false);
    }
  }

  deploy(): void {
    const project = this.projectService.activeProject();
    if (!project) return;
    this.deploymentService.deploy({ projectId: project.id, environment: 'production' }).subscribe({
      next: () => this.notifService.show('Deployment started!', 'success'),
      error: () => this.notifService.show('Deployment failed.', 'error')
    });
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      success: 'devpilot-deploys__status--success',
      failed: 'devpilot-deploys__status--failed',
      in_progress: 'devpilot-deploys__status--progress',
      pending: 'devpilot-deploys__status--pending'
    };
    return map[status] || '';
  }

  getStatusIcon(status: string): string {
    const map: Record<string, string> = {
      success: 'check-circle', failed: 'x-circle', in_progress: 'refresh-cw', pending: 'clock'
    };
    return map[status] || 'circle';
  }

  getRelativeTime(date: Date): string {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${Math.max(1, mins)}m ago`;
  }
}
