import { Injectable, signal } from '@angular/core';
import { Observable, of, delay } from 'rxjs';
import { Deployment, DeployPayload, DeploymentStatus } from '../../shared/models/deployment.model';

const MOCK_DEPLOYMENTS: Deployment[] = [
  {
    id: 'd1', projectId: '1', status: 'success', environment: 'production',
    url: 'https://ecommerce-api.devpilot.app', commit: 'a3f9bc2', branch: 'main',
    createdAt: new Date(Date.now() - 12 * 60 * 1000), duration: 87
  },
  {
    id: 'd2', projectId: '1', status: 'success', environment: 'production',
    url: 'https://ecommerce-api.devpilot.app', commit: 'e1d2f45', branch: 'main',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), duration: 94
  },
  {
    id: 'd3', projectId: '1', status: 'success', environment: 'staging',
    commit: 'c8b3a17', branch: 'develop',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), duration: 72
  },
  {
    id: 'd4', projectId: '1', status: 'failed', environment: 'production',
    commit: '9f4e321', branch: 'feature/payments',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), duration: 43
  }
];

const BUILD_LOG_STEPS = [
  '✓ Preparing build environment',
  '✓ Installing dependencies (npm ci)',
  '● Building application (tsc && ng build)',
  '○ Uploading artifacts',
  '○ Starting service',
  '○ Health check'
];

@Injectable({ providedIn: 'root' })
export class DeploymentService {
  readonly isDeploying = signal(false);
  readonly deployProgress = signal(0);
  readonly deployStep = signal('');
  readonly deployLogs = signal<string[]>([]);

  getDeployments(projectId: string): Observable<Deployment[]> {
    return of(MOCK_DEPLOYMENTS.filter((d) => d.projectId === projectId)).pipe(delay(500));
  }

  getLatestDeployment(projectId: string): Observable<Deployment | undefined> {
    const latest = MOCK_DEPLOYMENTS.find((d) => d.projectId === projectId && d.status === 'success');
    return of(latest).pipe(delay(300));
  }

  deploy(payload: DeployPayload): Observable<Deployment> {
    this.isDeploying.set(true);
    this.deployProgress.set(0);
    this.deployLogs.set([]);

    const newDeployment: Deployment = {
      id: String(Date.now()),
      projectId: payload.projectId,
      status: 'building' as DeploymentStatus,
      environment: payload.environment,
      branch: payload.branch || 'main',
      commit: Math.random().toString(16).substring(2, 9),
      createdAt: new Date()
    };

    // Simulate progress steps
    BUILD_LOG_STEPS.forEach((step, i) => {
      setTimeout(() => {
        this.deployProgress.set(Math.round(((i + 1) / BUILD_LOG_STEPS.length) * 100));
        this.deployStep.set(step);
        this.deployLogs.update((logs) => [...logs, step]);
        if (i === BUILD_LOG_STEPS.length - 1) {
          newDeployment.status = 'success';
          newDeployment.duration = 91;
          newDeployment.url = 'https://project.devpilot.app';
          MOCK_DEPLOYMENTS.unshift(newDeployment);
          this.isDeploying.set(false);
        }
      }, (i + 1) * 1000);
    });

    return of(newDeployment).pipe(delay(6500));
  }

  getLogs(_deploymentId: string): Observable<string[]> {
    return of([
      '> npm ci',
      'added 847 packages in 12.3s',
      '',
      '> ng build --configuration production',
      '✓ Browser application bundle generation complete.',
      '✓ Copying assets complete.',
      '✓ Index html generation complete.',
      '',
      'Build at: 2026-09-20T16:45:12.000Z - Hash: a3f9bc219e4d - Time: 14832ms',
      '',
      'Service started on port 5000',
      '✓ Health check passed'
    ]).pipe(delay(400));
  }
}
