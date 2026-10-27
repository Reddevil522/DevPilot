import { Component, Input, Output, EventEmitter, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../../core/services/project.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Project, ValidatePathResult } from '../../models/project.model';
import { SharedIconsModule } from '../../../shared/shared-icons.module';

@Component({
  selector: 'app-open-folder-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, SharedIconsModule],
  templateUrl: './open-folder-modal.component.html',
  styleUrl: './open-folder-modal.component.css'
})
export class OpenFolderModalComponent {
  @Input() isVisible = false;
  @Output() closed = new EventEmitter<void>();
  @Output() folderOpened = new EventEmitter<Project>();

  private projectService = inject(ProjectService);
  private notifService = inject(NotificationService);

  readonly localPath = signal('');
  readonly displayName = signal('');
  readonly isValidating = signal(false);
  readonly isBrowsing = signal(false);
  readonly isOpening = signal(false);
  readonly validationResult = signal<ValidatePathResult | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly isLocalBackend = computed(() => this.projectService.isLocalBackend());
  readonly apiHost = computed(() => this.projectService.getApiHost());

  private validateTimeout: any = null;

  close(): void {
    if (this.isOpening()) return;
    this.errorMessage.set(null);
    this.validationResult.set(null);
    this.localPath.set('');
    this.displayName.set('');
    this.closed.emit();
  }

  async onSelectFolder(): Promise<void> {
    if (this.isBrowsing() || this.isOpening()) return;

    this.isBrowsing.set(true);
    this.errorMessage.set(null);

    try {
      const selected = await this.projectService.selectFolder(this.localPath());
      if (selected) {
        this.localPath.set(selected);
        this.runValidation(selected);
        const folderName = selected.replace(/[/\\]+$/, '').split(/[/\\]/).pop();
        if (folderName && !this.displayName().trim()) {
          this.displayName.set(folderName);
        }
      }
    } catch (err: any) {
      console.error('[OpenFolderModal] Folder picker error:', err);
      this.errorMessage.set(err.message || 'Unable to open native folder selector. You can type or paste the directory path manually.');
    } finally {
      this.isBrowsing.set(false);
    }
  }

  onPathChange(newVal: string): void {
    const cleaned = newVal.replace(/^["']|["']$/g, '');
    this.localPath.set(cleaned);
    this.errorMessage.set(null);
    this.validationResult.set(null);

    if (this.validateTimeout) {
      clearTimeout(this.validateTimeout);
    }

    const trimmed = cleaned.trim();
    if (!trimmed) return;

    this.validateTimeout = setTimeout(() => {
      this.runValidation(trimmed);
    }, 350);
  }

  runValidation(targetPath: string): void {
    const cleaned = (targetPath || '').trim().replace(/^["']|["']$/g, '').trim();
    if (!cleaned) return;

    this.isValidating.set(true);
    this.errorMessage.set(null);

    this.projectService.validateWorkspacePath(cleaned).subscribe({
      next: (res) => {
        this.isValidating.set(false);
        this.validationResult.set(res);

        if (res.accessible) {
          if (!this.displayName().trim() && res.folderName) {
            this.displayName.set(res.folderName);
          }
        } else {
          this.errorMessage.set(res.message || 'Specified path is not an accessible directory.');
        }
      },
      error: (err) => {
        this.isValidating.set(false);
        this.errorMessage.set(err.error?.message || err.message || 'Validation request failed.');
      }
    });
  }

  onOpenFolder(): void {
    if (this.isOpening()) return;

    const pathVal = this.localPath().trim().replace(/^["']|["']$/g, '').trim();
    if (!pathVal) {
      this.errorMessage.set('Please select or enter a local folder path.');
      return;
    }

    if (this.validationResult() && !this.validationResult()?.accessible) {
      this.errorMessage.set(this.validationResult()?.message || 'Cannot open an invalid or inaccessible directory.');
      return;
    }

    this.isOpening.set(true);
    this.errorMessage.set(null);

    this.projectService.openExistingFolder({
      localPath: pathVal,
      displayName: this.displayName().trim() || undefined
    }).subscribe({
      next: (project) => {
        this.isOpening.set(false);
        const name = project.displayName || project.name || 'Project';
        this.notifService.show(`Workspace "${name}" opened successfully!`, 'success');
        this.folderOpened.emit(project);
        this.close();
      },
      error: (err) => {
        this.isOpening.set(false);
        const msg = err.error?.message || err.message || 'Failed to open directory as workspace.';
        this.errorMessage.set(msg);
        this.notifService.show(msg, 'error');
      }
    });
  }
}
