import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { AiService } from '../../core/services/ai.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { NotificationService } from '../../core/services/notification.service';
import { Project } from '../../shared/models/project.model';
import { AiAssistantComponent } from '../../workspace/ai-assistant/ai-assistant.component';
import { EditorComponent } from '../../workspace/editor/editor.component';
import { BottomPanelComponent } from '../../workspace/bottom-panel/bottom-panel.component';
import { SharedIconsModule } from '../../shared/shared-icons.module';

@Component({
  selector: 'app-project',
  standalone: true,
  imports: [CommonModule, AiAssistantComponent, EditorComponent, BottomPanelComponent, SharedIconsModule],
  templateUrl: './project.component.html',
  styleUrl: './project.component.css'
})
export class ProjectComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private projectService = inject(ProjectService);
  private workspaceService = inject(WorkspaceService);
  private aiService = inject(AiService);
  private notifService = inject(NotificationService);

  readonly project = signal<Project | null>(null);
  readonly aiPanelOpen = this.aiService.isPanelOpen;
  readonly bottomPanelOpen = signal(true);
  readonly isLoading = signal(true);
  readonly isNotFound = signal(false);
  readonly isInaccessible = signal(false);
  readonly unavailablePath = signal('');

  private currentProjectId: string | null = null;

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (!id) {
        this.router.navigate(['/dashboard']);
        return;
      }
      this.currentProjectId = id;
      this.loadProject(id);
    });
  }

  loadProject(id: string): void {
    this.isLoading.set(true);
    this.isNotFound.set(false);
    this.isInaccessible.set(false);

    this.projectService.getProject(id).subscribe({
      next: (p) => {
        if (!p) {
          this.isNotFound.set(true);
          this.isLoading.set(false);
          return;
        }

        if (p.isAccessible === false) {
          this.project.set(p);
          this.isInaccessible.set(true);
          this.unavailablePath.set(p.localPath || '');
          this.isLoading.set(false);
          return;
        }

        this.project.set(p);
        this.projectService.setActiveProject(p);
        this.workspaceService.openProject(p);
        this.aiService.resetProjectContext(p);

        // Update last opened in background
        this.projectService.updateLastOpened(p.id).subscribe({
          error: (err) => console.warn('[ProjectComponent] Failed to update lastOpenedAt:', err)
        });

        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err.status === 404) {
          this.isNotFound.set(true);
        } else if (err.status === 403) {
          this.notifService.show('You do not have permission to view this project.', 'error');
          this.router.navigate(['/dashboard']);
        } else {
          this.isNotFound.set(true);
        }
      }
    });
  }

  retryLoad(): void {
    if (this.currentProjectId) {
      this.loadProject(this.currentProjectId);
    }
  }

  backToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  toggleAiPanel(): void {
    this.aiService.togglePanel();
  }

  toggleBottomPanel(): void {
    this.bottomPanelOpen.update((v) => !v);
  }

  ngOnDestroy(): void {
    this.workspaceService.closeProject();
    this.projectService.setActiveProject(null);
  }
}


