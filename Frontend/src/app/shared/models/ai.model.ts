export type AIMessageRole = 'user' | 'assistant' | 'system';

export type AIProposalOperation = 'create' | 'edit';
export type AIProposalStatus = 'pending' | 'applied' | 'rejected';

export interface AIProposedChange {
  path: string;
  operation: AIProposalOperation;
  content: string;
  originalContent?: string;
  originalHash?: string;
  explanation?: string;
}

export interface AIProposal {
  summary: string;
  status: AIProposalStatus;
  changes: AIProposedChange[];
}

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  timestamp: Date;
  proposal?: AIProposal | null;
  isStreaming?: boolean;
  isError?: boolean;
  errorCode?: string;
}

export interface AIContext {
  currentFile?: string;
  selectedCode?: string;
  projectName?: string;
  projectId?: string;
  errorContext?: string;
}

export type DocumentationType =
  | 'readme'
  | 'api'
  | 'code'
  | 'architecture'
  | 'deployment'
  | 'proposal'
  | 'report'
  | 'meeting_notes'
  | 'study_notes'
  | 'business'
  | 'custom';

export type DocAudience = 'general' | 'developers' | 'stakeholders' | 'students' | 'executive';
export type DocTone = 'technical' | 'professional' | 'conversational' | 'concise' | 'instructional';
export type DocLength = 'short' | 'medium' | 'comprehensive';

export interface DocTypeOption {
  id: DocumentationType;
  name: string;
  description: string;
  defaultTitle: string;
}

export interface GenerateDocRequest {
  projectId: string;
  docType: DocumentationType;
  title?: string;
  instructions?: string;
  sourceContent?: string;
  audience?: DocAudience;
  tone?: DocTone;
  length?: DocLength;
  includeProjectContext?: boolean;
}

export interface ReviseDocRequest {
  documentId?: string;
  currentContent: string;
  revisionInstruction: string;
  docType?: DocumentationType;
  title?: string;
}

export interface SaveDocToProjectRequest {
  documentId?: string;
  projectId: string;
  targetPath?: string;
  content: string;
  saveToProject: boolean;
}

export interface GeneratedDocument {
  _id: string;
  projectId: string;
  userId: string;
  title: string;
  docType: DocumentationType;
  format: string;
  content: string;
  status: 'draft' | 'generating' | 'completed' | 'failed';
  version: number;
  metadata?: {
    wordCount?: number;
    sections?: string[];
    generationTimeMs?: number;
    model?: string;
    tone?: string;
    audience?: string;
    length?: string;
    error?: string;
    savedToPath?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface GenerateDocPayload {
  projectId: string;
  type: DocumentationType;
}

export interface AICodeAction {
  label: string;
  icon: string;
  action: string;
}
