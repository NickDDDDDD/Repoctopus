import { createHash } from 'node:crypto';

export const WORKSPACE_ENTRY_HOSTS = [
  'codex',
  'opencode',
  'codebuddy',
  'codearts',
  'trae',
  'trae-cn',
] as const;
export type WorkspaceEntryHost = (typeof WORKSPACE_ENTRY_HOSTS)[number];

const ownershipMarker = /\n<!-- repoctopus-entry:v1 SKILL\.md ([a-f0-9]{64}) -->\n$/u;

export function workspaceEntryDigest(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

export function markWorkspaceEntrySkill(body: string): string {
  return `${body}\n<!-- repoctopus-entry:v1 SKILL.md ${workspaceEntryDigest(body)} -->\n`;
}

export function isOwnedWorkspaceEntrySkill(text: string): boolean {
  const normalized = text.replaceAll('\r\n', '\n');
  const match = ownershipMarker.exec(normalized);
  return Boolean(match && workspaceEntryDigest(normalized.slice(0, match.index)) === match[1]);
}

export interface WorkspaceEntrySkillPlan {
  host: WorkspaceEntryHost;
  path: string;
  status: 'create' | 'update' | 'keep' | 'conflict';
  beforeDigest: string | null;
  contentDigest: string;
  diagnostic?: string;
  files?: Array<{ path: string; beforeDigest: string | null; contentDigest: string | null }>;
}

/** Separate ownership metadata from the native Skill and its resources. */
export function workspaceWorkflowSkillManifestPath(skillFile: string): string {
  const [hostDirectory, , name] = skillFile.split('/');
  return `${hostDirectory}/.repoctopus-workflow-skills/${name}.json`;
}

export const WORKSPACE_WORKFLOW_SKILL_MARKER = 'repoctopus-workflow-install: true';
