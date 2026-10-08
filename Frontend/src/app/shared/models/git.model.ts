export type GitChangeStatus = 'M' | 'A' | 'D' | 'R' | 'U';

export interface GitChange {
  file: string;
  status: GitChangeStatus;
  staged: boolean;
  path: string;
}

export interface GitCommitPayload {
  message: string;
  files: string[];
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
}
