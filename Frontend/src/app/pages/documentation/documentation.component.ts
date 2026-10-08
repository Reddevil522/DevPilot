import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { AiService } from '../../core/services/ai.service';
import { ProjectService } from '../../core/services/project.service';
import { DocumentationType } from '../../shared/models/ai.model';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

interface DocCard {
  title: string;
  description: string;
  icon: string;
  type: DocumentationType;
  lastGenerated?: string;
}

type DocView = 'grid' | 'generator' | 'viewer';

const DOC_CARDS: DocCard[] = [
  { title: 'README', description: 'Project overview and getting started guide', icon: 'file-text', type: 'readme', lastGenerated: '2 hours ago' },
  { title: 'API Reference', description: 'Complete API endpoint documentation', icon: 'zap', type: 'api' },
  { title: 'Architecture', description: 'System design and component overview', icon: 'layers', type: 'architecture' },
  { title: 'Setup Guide', description: 'Environment setup and configuration', icon: 'settings', type: 'readme' },
  { title: 'Code Docs', description: 'Auto-generated code documentation', icon: 'code-2', type: 'code' },
  { title: 'Deployment Guide', description: 'Deploy to production instructions', icon: 'rocket', type: 'deployment' }
];

@Component({
  selector: 'app-documentation',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedIconsModule],
  templateUrl: './documentation.component.html',
  styleUrl: './documentation.component.css'
})
export class DocumentationComponent {
  private aiService = inject(AiService);
  private projectService = inject(ProjectService);
  private notifService = inject(NotificationService);

  readonly docCards = DOC_CARDS;
  readonly view = signal<DocView>('grid');
  readonly selectedType = new FormControl<DocumentationType>('readme');
  readonly isGenerating = signal(false);
  readonly generatedContent = signal<string | null>(null);
  readonly generationStep = signal('');

  readonly generationSteps = ['Analyzing project...', 'Analyzing files...', 'Understanding architecture...', 'Generating documentation...'];
  readonly currentStep = signal(0);

  readonly docTypes: { value: DocumentationType; label: string; desc: string }[] = [
    { value: 'readme', label: 'README', desc: 'Project overview and quick start' },
    { value: 'api', label: 'API Documentation', desc: 'Endpoints and request/response schemas' },
    { value: 'code', label: 'Code Documentation', desc: 'Function and class docs' },
    { value: 'architecture', label: 'Architecture Docs', desc: 'System design overview' },
    { value: 'deployment', label: 'Deployment Guide', desc: 'Production deployment instructions' }
  ];

  openGenerator(type?: DocumentationType): void {
    if (type) this.selectedType.setValue(type);
    this.view.set('generator');
  }

  generate(): void {
    this.isGenerating.set(true);
    this.currentStep.set(0);
    this.generatedContent.set(null);

    const steps = this.generationSteps;
    steps.forEach((step, i) => {
      setTimeout(() => {
        this.generationStep.set(step);
        this.currentStep.set(i + 1);
      }, i * 700);
    });

    const projectId = this.projectService.activeProject()?.id || '1';
    const type = this.selectedType.value || 'readme';

    this.aiService.generateDocumentation(projectId, type).subscribe({
      next: (content) => {
        this.isGenerating.set(false);
        this.generatedContent.set(content);
        this.view.set('viewer');
        this.notifService.show('Documentation generated!', 'success');
      },
      error: () => {
        this.isGenerating.set(false);
        this.notifService.show('Failed to generate documentation.', 'error');
      }
    });
  }

  backToGrid(): void { this.view.set('grid'); }
}
