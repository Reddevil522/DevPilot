export type DeploymentStatus = 'success' | 'building' | 'failed' | 'stopped' | 'queued';
export type DeploymentEnvironment = 'production' | 'staging' | 'preview';

export interface Deployment {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  environment: DeploymentEnvironment;
  url?: string;
  commit?: string;
  branch?: string;
  createdAt: Date;
  duration?: number; // seconds
  buildLogs?: string[];
}

export interface DeployPayload {
  projectId: string;
  environment: DeploymentEnvironment;
  branch?: string;
}
