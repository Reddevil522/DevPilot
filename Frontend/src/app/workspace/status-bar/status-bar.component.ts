import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../../core/services/project.service';
import { EditorService } from '../../core/services/editor.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [CommonModule, SharedIconsModule],
  templateUrl: './status-bar.component.html',
  styleUrl: './status-bar.component.css'
})
export class StatusBarComponent {
  readonly projectService = inject(ProjectService);
  readonly editorService = inject(EditorService);
  readonly branch = 'main';
  readonly errors = 0;
  readonly warnings = 2;
  readonly language = 'TypeScript';
  readonly encoding = 'UTF-8';
  readonly lineEnding = 'LF';
  readonly line = 1;
  readonly col = 1;
}
