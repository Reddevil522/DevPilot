import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { AiService } from '../../core/services/ai.service';
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
export class ProjectComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private projectService = inject(ProjectService);
  private aiService = inject(AiService);

  readonly project = signal<Project | null>(null);
  readonly aiPanelOpen = this.aiService.isPanelOpen;
  readonly bottomPanelOpen = signal(true);
  readonly isLoading = signal(true);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '1';
    this.projectService.getProject(id).subscribe((p) => {
      if (p) {
        this.project.set(p);
        this.projectService.setActiveProject(p);
        this.aiService.updateContext({ projectName: p.name, projectId: p.id });
      }
      this.isLoading.set(false);
    });
  }

  toggleAiPanel(): void {
    this.aiService.togglePanel();
  }
  toggleBottomPanel(): void { this.bottomPanelOpen.update((v) => !v); }
}
