export type AIMessageRole = 'user' | 'assistant' | 'system';

export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface AIContext {
  currentFile?: string;
  selectedCode?: string;
  projectName?: string;
  projectId?: string;
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
