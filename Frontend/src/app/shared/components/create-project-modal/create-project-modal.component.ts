import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ProjectService } from '../../../core/services/project.service';
import { Project, CreateProjectPayload } from '../../models/project.model';
import { NotificationService } from '../../../core/services/notification.service';
import { SharedIconsModule } from '../../../shared/shared-icons.module';

type ModalStep = 'form' | 'creating' | 'success';

const CREATION_STEPS = [
  'Creating project',
  'Creating workspace',
  'Generating files',
  'Preparing environment',
  'Loading project'
];

@Component({
  selector: 'app-create-project-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedIconsModule],
  templateUrl: './create-project-modal.component.html',
  styleUrl: './create-project-modal.component.css'
})
export class CreateProjectModalComponent {
  @Input() isVisible = false;
  @Output() closed = new EventEmitter<void>();
  @Output() projectCreated = new EventEmitter<Project>();

  private fb = inject(FormBuilder);
  private projectService = inject(ProjectService);
  private notifService = inject(NotificationService);

  readonly step = signal<ModalStep>('form');
  readonly creatingSteps = signal<string[]>([]);
  readonly currentStep = signal(-1);
  readonly createdProject = signal<Project | null>(null);

  readonly form = this.fb.group({
    name: ['my-awesome-project', [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)]],
    description: ['', [Validators.maxLength(200)]],
    technology: ['nodejs', Validators.required],
    template: ['blank', Validators.required],
    projectType: ['local', Validators.required],
    localPath: ['D:\\Projects', [Validators.required]]
  });

  constructor() {}

  readonly technologies = [
    { value: 'angular', label: 'Angular', icon: 'layers' },
    { value: 'react', label: 'React', icon: 'cpu' },
    { value: 'nodejs', label: 'Node.js', icon: 'server' },
    { value: 'express', label: 'Express', icon: 'rocket' },
    { value: 'fullstack', label: 'Full Stack', icon: 'zap' },
    { value: 'custom', label: 'Custom', icon: 'settings' }
  ];

  readonly templates = [
    { value: 'blank', label: 'Blank', desc: 'Start fresh' },
    { value: 'mean', label: 'MEAN', desc: 'MongoDB + Express + Angular + Node' },
    { value: 'mern', label: 'MERN', desc: 'MongoDB + Express + React + Node' },
    { value: 'angular', label: 'Angular', desc: 'Angular SPA with routing' },
    { value: 'node-api', label: 'Node API', desc: 'REST API with Express' },
    { value: 'ai-app', label: 'AI Application', desc: 'AI-powered app template' }
  ];

  close(): void {
    if (this.step() !== 'creating') {
      this.step.set('form');
      this.currentStep.set(-1);
      this.creatingSteps.set([]);
      this.closed.emit();
    }
  }

  onCreate(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.step.set('creating');
    this.currentStep.set(0);
    this.creatingSteps.set(['Starting project generation...']);

    const payload = this.form.getRawValue() as CreateProjectPayload;

    this.projectService.createProject(payload).subscribe({
      next: (project: Project) => {
        this.currentStep.set(this.creatingSteps().length - 1);
        this.createdProject.set(project);

        setTimeout(() => {
          this.step.set('success');
          this.notifService.show(`Project "${project.name}" created!`, 'success');
        }, 800);
      },
      error: (err: any) => {
        console.error(err);
        this.step.set('form');
        this.notifService.show(err.message || 'Failed to create project. Please try again.', 'error');
      }
    });
  }

  openWorkspace(): void {
    const project = this.createdProject();
    if (project) {
      this.projectCreated.emit(project);
      this.close();
    }
  }
}
