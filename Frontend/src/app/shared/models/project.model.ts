export type ProjectStatus = 'active' | 'inactive' | 'archived';
export type ProjectTechnology = 'angular' | 'react' | 'nodejs' | 'express' | 'fullstack' | 'custom';
export type ProjectTemplate = 'blank' | 'mean' | 'mern' | 'angular' | 'node-api' | 'ai-app';

export interface Project {
  id: string;
  projectId?: string;
  name: string;
  projectName?: string;
  description: string;
  technology: ProjectTechnology;
  framework?: string;
  template: ProjectTemplate;
  projectType: 'local' | 'cloud';
  status: ProjectStatus;
  language: string;
  localPath?: string;
  lastOpenedAt?: Date | string;
  updatedAt: Date | string;
  createdAt: Date | string;
  deploymentUrl?: string;
  gitBranch?: string;
  gitRepo?: string;
}

export interface CreateProjectPayload {
  name: string;
  description: string;
  technology: ProjectTechnology;
  template: ProjectTemplate;
  projectType: 'local' | 'cloud';
  localPath?: string;
}

export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  extension?: string;
  children?: FileNode[];
  isOpen?: boolean;
  /** True once the folder's immediate children have been lazily fetched. */
  childrenLoaded?: boolean;
  handle?: any; // FileSystemHandle or FileSystemDirectoryHandle
}
