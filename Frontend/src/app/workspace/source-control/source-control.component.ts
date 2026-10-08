import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { GitService } from '../../core/services/git.service';
import { GitChange, GitStatus } from '../../shared/models/git.model';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-source-control',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './source-control.component.html',
  styleUrl: './source-control.component.css'
})
export class SourceControlComponent implements OnInit {
  private gitService = inject(GitService);
  private notifService = inject(NotificationService);

  readonly status = signal<GitStatus | null>(null);
  readonly isLoading = signal(true);
  readonly commitMessage = new FormControl('', Validators.required);
  readonly isCommitting = this.gitService.isCommitting;
  readonly isPushing = this.gitService.isPushing;

  ngOnInit(): void {
    this.gitService.getStatus('1').subscribe((s) => {
      this.status.set(s);
      this.isLoading.set(false);
    });
  }

  getChanges(): GitChange[] {
    return this.status()?.changes || [];
  }

  getUnstagedChanges(): GitChange[] {
    return this.getChanges().filter((c) => !c.staged);
  }

  getStagedChanges(): GitChange[] {
    return this.getChanges().filter((c) => c.staged);
  }

  stageFile(change: GitChange): void {
    this.gitService.stageFile(change).subscribe(() => {
      this.status.update((s) => s ? { ...s, changes: [...s.changes] } : s);
    });
  }

  unstageFile(change: GitChange): void {
    this.gitService.unstageFile(change).subscribe(() => {
      this.status.update((s) => s ? { ...s, changes: [...s.changes] } : s);
    });
  }

  stageAll(): void {
    this.gitService.stageAll().subscribe((staged) => {
      this.status.update((s) => s ? { ...s, changes: staged } : s);
    });
  }

  commit(): void {
    if (!this.commitMessage.value) return;
    const msg = this.commitMessage.value;
    const staged = this.getStagedChanges().map((c) => c.file);
    this.gitService.commit({ message: msg, files: staged }).subscribe((res) => {
      this.gitService.isCommitting.set(false);
      this.commitMessage.reset();
      this.notifService.show(`Committed: ${res.commitHash}`, 'success');
    });
  }

  push(): void {
    this.gitService.push().subscribe(() => {
      this.gitService.isPushing.set(false);
      this.notifService.show('Git push completed', 'success');
    });
  }

  getStatusBadgeClass(status: string): string {
    const map: Record<string, string> = {
      'M': 'devpilot-sc__badge--modified',
      'A': 'devpilot-sc__badge--added',
      'D': 'devpilot-sc__badge--deleted'
    };
    return map[status] || '';
  }
}
