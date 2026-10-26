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
  | 'deployment';

export interface GenerateDocPayload {
  projectId: string;
  type: DocumentationType;
}

export interface AICodeAction {
  label: string;
  icon: string;
  action: string;
}
