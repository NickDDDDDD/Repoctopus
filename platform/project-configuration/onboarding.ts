import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { stringify } from 'yaml';

import { hashProjectConfig } from '../../domains/project-configuration/config.js';
import type { ProjectDetectionDraft } from '../../domains/project-configuration/detection.js';
import {
  createProjectConfigurationDecision,
  recordProjectConfigurationDecision,
  type ProjectConfigurationDecisionActor,
  type ProjectConfigurationDecisionRequest,
  type ProjectConfigurationDecisionResponse,
} from '../../domains/project-configuration/onboarding.js';
import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { loadProjectConfig } from './file-config.js';
import { ensureRepoctopusGitignore } from './gitignore.js';

interface StoredProjectConfigurationDecision {
  schemaVersion: 1;
  kind: 'ProjectConfigurationDecisionState';
  status: 'awaiting_confirmation';
  request: ProjectConfigurationDecisionRequest;
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function safeInputFile(workspace: string, file: string, directory: string): Promise<string> {
  const allowed = path.resolve(workspace, '.repoctopus', directory);
  const resolved = path.resolve(file);
  if (!contained(allowed, resolved)) throw new Error(`File is outside .repoctopus/${directory}`);
  const details = await lstat(resolved);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Expected a regular local ${directory} file`);
  }
  const [realAllowed, realFile] = await Promise.all([realpath(allowed), realpath(resolved)]);
  if (!contained(realAllowed, realFile)) {
    throw new Error(`Resolved file is outside .repoctopus/${directory}`);
  }
  return realFile;
}

function asDraft(value: unknown): ProjectDetectionDraft {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { apiVersion?: unknown }).apiVersion !== 'repoctopus/v1alpha1' ||
    (value as { kind?: unknown }).kind !== 'ProjectDetectionDraft' ||
    typeof (value as { draftId?: unknown }).draftId !== 'string'
  ) {
    throw new Error('Invalid project detection draft');
  }
  return value as ProjectDetectionDraft;
}

function asStoredDecision(value: unknown): StoredProjectConfigurationDecision {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { kind?: unknown }).kind !== 'ProjectConfigurationDecisionState' ||
    (value as { status?: unknown }).status !== 'awaiting_confirmation'
  ) {
    throw new Error('Invalid project configuration decision state');
  }
  return value as StoredProjectConfigurationDecision;
}

async function optionalCurrentConfig(workspace: string): Promise<SharedProjectConfig | null> {
  try {
    return (await loadProjectConfig(workspace)).shared;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function decisionFile(workspace: string, requestId: string): string {
  return path.join(
    workspace,
    '.repoctopus',
    'decisions',
    `project-configuration-${requestId}.json`,
  );
}

export async function prepareProjectConfigurationDecision(input: {
  workspace: string;
  draftFile: string;
  completedCandidate: unknown;
  requestId?: string;
}): Promise<{ request: ProjectConfigurationDecisionRequest; file: string }> {
  const workspace = path.resolve(input.workspace);
  const draftFile = await safeInputFile(workspace, input.draftFile, 'drafts');
  const draft = asDraft(JSON.parse(await readFile(draftFile, 'utf8')) as unknown);
  const currentConfig = await optionalCurrentConfig(workspace);
  const request = createProjectConfigurationDecision({
    draft,
    completedCandidate: input.completedCandidate,
    currentConfig,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  });
  const state: StoredProjectConfigurationDecision = {
    schemaVersion: 1,
    kind: 'ProjectConfigurationDecisionState',
    status: 'awaiting_confirmation',
    request,
  };
  const file = decisionFile(workspace, request.requestId);
  await atomicWriteJson(file, state);
  await atomicWriteJson(draftFile, {
    ...draft,
    status: 'awaiting_confirmation',
    candidateConfig: request.candidateConfig,
    reconcile: request.reconcile,
  } satisfies ProjectDetectionDraft);
  return { request, file };
}

export async function loadPendingProjectConfigurationDecision(
  workspace: string,
  file: string,
): Promise<ProjectConfigurationDecisionRequest> {
  const resolvedWorkspace = path.resolve(workspace);
  const stateFile = await safeInputFile(resolvedWorkspace, file, 'decisions');
  return asStoredDecision(JSON.parse(await readFile(stateFile, 'utf8')) as unknown).request;
}

export async function applyProjectConfigurationDecision(input: {
  workspace: string;
  decisionFile: string;
  response: ProjectConfigurationDecisionResponse;
  actor: ProjectConfigurationDecisionActor;
  timestamp: string;
}): Promise<{
  status: 'confirmed' | 'request_changes' | 'rejected';
  configFile: string | null;
  configDigest: string | null;
}> {
  const workspace = path.resolve(input.workspace);
  const stateFile = await safeInputFile(workspace, input.decisionFile, 'decisions');
  const state = asStoredDecision(JSON.parse(await readFile(stateFile, 'utf8')) as unknown);
  const record = recordProjectConfigurationDecision({
    request: state.request,
    response: input.response,
    actor: input.actor,
    timestamp: input.timestamp,
  });
  if (record.decision !== 'approve') {
    await atomicWriteJson(stateFile, {
      ...state,
      status: record.decision === 'reject' ? 'rejected' : 'request_changes',
      record,
    });
    return {
      status: record.decision === 'reject' ? 'rejected' : 'request_changes',
      configFile: null,
      configDigest: null,
    };
  }

  const current = await optionalCurrentConfig(workspace);
  const currentDigest = current ? hashProjectConfig(current) : null;
  if (currentDigest !== state.request.baseConfigDigest) {
    throw new Error('Shared project configuration changed while awaiting confirmation');
  }
  const candidateDigest = hashProjectConfig(state.request.candidateConfig);
  if (candidateDigest !== state.request.candidateConfigDigest) {
    throw new Error('Approved project configuration no longer matches its digest');
  }
  const configFile = path.join(workspace, 'repoctopus.yaml');
  const draftFile = path.join(
    workspace,
    '.repoctopus',
    'drafts',
    `project-detect-${state.request.draftId}.json`,
  );
  const draft = asDraft(JSON.parse(await readFile(draftFile, 'utf8')) as unknown);
  await atomicWriteText(configFile, stringify(state.request.candidateConfig, { lineWidth: 0 }));
  await ensureRepoctopusGitignore(workspace);
  const written = await loadProjectConfig(workspace);
  if (written.sharedDigest !== candidateDigest) {
    throw new Error('Written project configuration does not match the approved digest');
  }
  await atomicWriteJson(draftFile, {
    ...draft,
    status: 'confirmed',
  } satisfies ProjectDetectionDraft);
  await atomicWriteJson(stateFile, { ...state, status: 'confirmed', record });
  return { status: 'confirmed', configFile, configDigest: written.sharedDigest };
}
