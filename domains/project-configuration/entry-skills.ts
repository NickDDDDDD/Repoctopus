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

export const WORKSPACE_ENTRY_DIRECTORIES: Record<
  WorkspaceEntryHost,
  { workspace: string; personal: string; label: string }
> = {
  codex: { label: 'Codex', workspace: '.agents', personal: '.codex' },
  opencode: { label: 'OpenCode', workspace: '.opencode', personal: '.config/opencode' },
  codebuddy: { label: 'CodeBuddy Code', workspace: '.codebuddy', personal: '.codebuddy' },
  codearts: { label: 'CodeArts 码道', workspace: '.codeartsdoer', personal: '.codeartsdoer' },
  trae: { label: 'TRAE 国际版', workspace: '.trae', personal: '.trae' },
  'trae-cn': { label: 'TRAE 中国版', workspace: '.trae', personal: '.trae-cn' },
};

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
