import { Injectable, signal } from '@angular/core';
import { Observable, of, delay } from 'rxjs';
import { GitChange, GitStatus, GitCommitPayload } from '../../shared/models/git.model';

const MOCK_CHANGES: GitChange[] = [
  { file: 'src/app.ts', status: 'M', staged: false, path: 'src/app.ts' },
  { file: 'package.json', status: 'M', staged: false, path: 'package.json' },
  { file: 'src/services/auth.service.ts', status: 'A', staged: true, path: 'src/services/auth.service.ts' },
  { file: 'src/models/old-model.ts', status: 'D', staged: false, path: 'src/models/old-model.ts' }
];

@Injectable({ providedIn: 'root' })
export class GitService {
  readonly isPushing = signal(false);
  readonly isCommitting = signal(false);

  getStatus(_projectId: string): Observable<GitStatus> {
    return of({
      branch: 'main',
      ahead: 2,
      behind: 0,
      changes: [...MOCK_CHANGES]
    }).pipe(delay(400));
  }

  stageFile(change: GitChange): Observable<GitChange> {
    change.staged = true;
    return of(change).pipe(delay(200));
  }

  unstageFile(change: GitChange): Observable<GitChange> {
    change.staged = false;
    return of(change).pipe(delay(200));
  }

  stageAll(): Observable<GitChange[]> {
    const staged = MOCK_CHANGES.map((c) => ({ ...c, staged: true }));
    return of(staged).pipe(delay(300));
  }

  commit(payload: GitCommitPayload): Observable<{ success: boolean; commitHash: string }> {
    this.isCommitting.set(true);
    return of({ success: true, commitHash: Math.random().toString(16).substring(2, 9) }).pipe(
      delay(800)
    );
  }

  push(): Observable<{ success: boolean }> {
    this.isPushing.set(true);
    return of({ success: true }).pipe(delay(1500));
  }

  pull(): Observable<{ success: boolean; message: string }> {
    return of({ success: true, message: 'Already up to date.' }).pipe(delay(600));
  }
}
