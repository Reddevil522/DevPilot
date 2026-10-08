export type ProjectStatus = 'active' | 'inactive' | 'archived';
export type ProjectTechnology = 'angular' | 'react' | 'nodejs' | 'express' | 'fullstack' | 'custom';
export type ProjectTemplate = 'blank' | 'mean' | 'mern' | 'angular' | 'node-api' | 'ai-app';

export interface Project {
  id: string;
  name: string;
  description: string;
  technology: ProjectTechnology;
  template: ProjectTemplate;
  projectType: 'local' | 'cloud';
  status: ProjectStatus;
  language: string;
  updatedAt: Date;
  createdAt: Date;
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
  handle?: any; // FileSystemHandle or FileSystemDirectoryHandle
}
