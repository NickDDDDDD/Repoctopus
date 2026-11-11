export const WORKSPACE_ENTRY_HOSTS = ['codex', 'opencode'] as const;
export type WorkspaceEntryHost = (typeof WORKSPACE_ENTRY_HOSTS)[number];

export interface WorkspaceEntrySkillPlan {
  host: WorkspaceEntryHost;
  path: string;
  status: 'create' | 'update' | 'keep' | 'conflict';
  beforeDigest: string | null;
  contentDigest: string;
  diagnostic?: string;
}
