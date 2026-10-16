export interface WorktreeSummary {
  dirty: boolean;
  digest: string;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface RepositorySnapshot {
  id: string;
  name: string;
  path: string;
  remoteIdentity: string | null;
  branch: string | null;
  head: string;
  worktree: WorktreeSummary;
}

export interface ProjectSnapshot {
  schemaVersion: 1;
  projectId: string;
  root: string;
  capturedAt: string;
  repositories: RepositorySnapshot[];
  diagnostics: Array<{
    code: 'path-unreadable' | 'path-outside-root';
    path: string;
    message: string;
  }>;
  digest: string;
}

export interface RepositoryDifference {
  repositoryId: string;
  repositoryName: string;
  fields: Array<'path' | 'remoteIdentity' | 'branch' | 'head' | 'worktree'>;
}

export interface ProjectReconciliation {
  changed: boolean;
  previousDigest: string;
  currentDigest: string;
  added: string[];
  removed: string[];
  changedRepositories: RepositoryDifference[];
}
