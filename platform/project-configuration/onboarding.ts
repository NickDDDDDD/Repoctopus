import { createHash } from 'node:crypto';
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
import type { OpenSpecStoreBindingProposal } from '../../domains/project-configuration/detection.js';
import { atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { loadProjectConfig } from './file-config.js';
import { ensureRepoctopusGitignore } from './gitignore.js';
import {
  createStoreBindingIntent,
  createStoreBindingReceipt,
  type StoreBindingIntent,
  type StoreBindingReceipt,
} from '../../domains/project-configuration/store-binding.js';
import {
  OPENSPEC_ROOT_INITIALIZATION_ARGS,
  OpenSpecStoreRegistration,
  type OpenSpecStoreRegistrationPort,
} from '../specification/openspec-store-registration.js';

interface StoredProjectConfigurationDecision {
  schemaVersion: 1;
  kind: 'ProjectConfigurationDecisionState';
  status: 'awaiting_confirmation' | 'applying' | 'confirmed' | 'request_changes' | 'rejected';
  request: ProjectConfigurationDecisionRequest;
  record?: ReturnType<typeof recordProjectConfigurationDecision>;
  result?: ProjectConfigurationApplyResult;
}

export interface ProjectConfigurationApplyResult {
  status: 'confirmed' | 'request_changes' | 'rejected';
  configFile: string | null;
  configDigest: string | null;
  bindingReceiptFiles: string[];
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function safeInputFile(
  workspace: string,
  inputWorkspace: string,
  file: string,
  directory: string,
): Promise<string> {
  const allowed = path.join(workspace, '.repoctopus', directory);
  const inputAllowed = path.resolve(inputWorkspace, '.repoctopus', directory);
  const resolved = path.resolve(file);
  if (!contained(allowed, resolved) && !contained(inputAllowed, resolved)) {
    throw new Error(`File is outside .repoctopus/${directory}`);
  }
  const details = await lstat(resolved);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Expected a regular local ${directory} file`);
  }
  const [realAllowed, realFile] = await Promise.all([realpath(allowed), realpath(resolved)]);
  if (!contained(workspace, realAllowed) || !contained(realAllowed, realFile)) {
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
    !['awaiting_confirmation', 'applying', 'confirmed', 'request_changes', 'rejected'].includes(
      String((value as { status?: unknown }).status),
    )
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

async function optionalRegularText(file: string): Promise<string | null> {
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error(`Store pointer is not a regular file: ${file}`);
    }
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function existingJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function persistIntent(
  root: string,
  intent: StoreBindingIntent,
  containedRoot: string,
): Promise<string> {
  const file = path.join(root, `${intent.actionId}.intent.json`);
  const current = await existingJson<StoreBindingIntent>(file);
  if (current && current.digest !== intent.digest) {
    throw new Error(`Store binding Intent drifted: ${intent.actionId}`);
  }
  if (!current) await atomicWriteJson(file, intent, { containedRoot });
  return file;
}

async function persistReceipt(
  root: string,
  receipt: StoreBindingReceipt,
  containedRoot: string,
): Promise<string> {
  const file = path.join(root, `${receipt.actionId}.receipt.json`);
  const current = await existingJson<StoreBindingReceipt>(file);
  if (current && current.intentDigest !== receipt.intentDigest) {
    throw new Error(`Store binding Receipt belongs to another Intent: ${receipt.actionId}`);
  }
  if (!current) await atomicWriteJson(file, receipt, { containedRoot });
  return file;
}

async function applyStoreBinding(input: {
  workspace: string;
  requestId: string;
  candidate: SharedProjectConfig;
  proposal: OpenSpecStoreBindingProposal;
  timestamp: string;
  registration: OpenSpecStoreRegistrationPort;
  hooks?: {
    afterIntent?(intent: StoreBindingIntent): Promise<void> | void;
    afterPointerWrite?(intent: StoreBindingIntent): Promise<void> | void;
  };
}): Promise<string[]> {
  const journalRoot = path.join(
    input.workspace,
    '.repoctopus',
    'onboarding',
    'store-bindings',
    input.requestId,
  );
  const receiptFiles: string[] = [];
  const localStateRoot = path.join(input.workspace, '.repoctopus');
  if (
    !['registered-exact', 'healthy-unregistered', 'missing-root'].includes(
      input.proposal.root.disposition,
    )
  ) {
    throw new Error(
      `Approved OpenSpec Root is not applicable: ${input.proposal.root.diagnosticCode ?? input.proposal.root.disposition}`,
    );
  }
  const rootIntent = createStoreBindingIntent({
    actionId: 'prepare-root',
    requestId: input.requestId,
    action: 'prepare-root',
    storeId: input.proposal.storeId,
    repositoryId: input.proposal.workspaceRepositoryId,
    root: {
      disposition: input.proposal.root.disposition as
        | 'registered-exact'
        | 'healthy-unregistered'
        | 'missing-root',
      providerVersion: input.proposal.root.providerVersion,
      workspaceRoot: input.proposal.workspaceRoot,
      initializationArgs: [
        'init',
        input.proposal.workspaceRoot,
        ...OPENSPEC_ROOT_INITIALIZATION_ARGS,
      ],
      evidenceDigest: input.proposal.root.digest,
    },
  });
  const previousRootIntent = await existingJson<StoreBindingIntent>(
    path.join(journalRoot, `${rootIntent.actionId}.intent.json`),
  );
  await persistIntent(journalRoot, rootIntent, localStateRoot);
  const rootReceiptFile = path.join(journalRoot, 'prepare-root.receipt.json');
  const previousRootReceipt = await existingJson<StoreBindingReceipt>(rootReceiptFile);
  if (previousRootReceipt) {
    if (previousRootReceipt.intentDigest !== rootIntent.digest) {
      throw new Error('Root preparation Receipt belongs to another Intent');
    }
    receiptFiles.push(rootReceiptFile);
  } else {
    await input.hooks?.afterIntent?.(rootIntent);
    const prepared = await input.registration.prepareRoot({
      expected: input.proposal.root,
      allowRecovery: previousRootIntent !== null,
    });
    receiptFiles.push(
      await persistReceipt(
        journalRoot,
        createStoreBindingReceipt({
          actionId: rootIntent.actionId,
          intentDigest: rootIntent.digest,
          result: prepared.status,
          evidenceDigest: prepared.evidenceDigest,
          completedAt: input.timestamp,
        }),
        localStateRoot,
      ),
    );
  }
  const registrationIntent = createStoreBindingIntent({
    actionId: 'register-store',
    requestId: input.requestId,
    action: 'register-store',
    storeId: input.proposal.storeId,
    repositoryId: input.proposal.workspaceRepositoryId,
  });
  await persistIntent(journalRoot, registrationIntent, localStateRoot);
  const registrationReceiptFile = path.join(journalRoot, 'register-store.receipt.json');
  const previousRegistration = await existingJson<StoreBindingReceipt>(registrationReceiptFile);
  if (previousRegistration) {
    if (previousRegistration.intentDigest !== registrationIntent.digest) {
      throw new Error('Store registration Receipt belongs to another Intent');
    }
    const current = await input.registration.inspect({
      storeId: input.proposal.storeId,
      workspace: input.workspace,
    });
    if (current.disposition !== 'registered-exact' || current.workspaceRoot !== input.workspace) {
      throw new Error(
        `Store registration changed after approval: ${current.diagnosticCode ?? current.disposition}`,
      );
    }
    receiptFiles.push(registrationReceiptFile);
  } else {
    await input.hooks?.afterIntent?.(registrationIntent);
    const registered = await input.registration.ensureRegistered({
      storeId: input.proposal.storeId,
      workspace: input.workspace,
    });
    receiptFiles.push(
      await persistReceipt(
        journalRoot,
        createStoreBindingReceipt({
          actionId: registrationIntent.actionId,
          intentDigest: registrationIntent.digest,
          result: registered.status,
          evidenceDigest: registered.registrationDigest,
          completedAt: input.timestamp,
        }),
        localStateRoot,
      ),
    );
  }

  for (const binding of input.proposal.repositories) {
    if (binding.selection !== 'install') continue;
    if (!binding.pointerDiff?.after || binding.pointerDiff.before !== null) {
      throw new Error(`Store pointer plan is not a safe create: ${binding.repositoryId}`);
    }
    const repository = input.candidate.repositories.find(
      (candidate) => candidate.id === binding.repositoryId,
    );
    if (!repository)
      throw new Error(`Store pointer repository is not configured: ${binding.repositoryId}`);
    const repositoryRoot = path.resolve(input.workspace, repository.path);
    const pointer = path.join(repositoryRoot, binding.pointerDiff.path);
    const intent = createStoreBindingIntent({
      actionId: `pointer-${binding.repositoryId}`,
      requestId: input.requestId,
      action: 'write-pointer',
      storeId: input.proposal.storeId,
      repositoryId: binding.repositoryId,
      pointer: {
        path: binding.pointerDiff.path,
        before: binding.pointerDiff.before,
        after: binding.pointerDiff.after,
      },
    });
    await persistIntent(journalRoot, intent, localStateRoot);
    const receiptFile = path.join(journalRoot, `${intent.actionId}.receipt.json`);
    const previous = await existingJson<StoreBindingReceipt>(receiptFile);
    if (previous) {
      if (previous.intentDigest !== intent.digest) {
        throw new Error(`Store pointer Receipt belongs to another Intent: ${binding.repositoryId}`);
      }
      if ((await optionalRegularText(pointer)) !== binding.pointerDiff.after) {
        throw new Error(`Applied Store pointer drifted: ${binding.repositoryId}`);
      }
      receiptFiles.push(receiptFile);
      continue;
    }
    await input.hooks?.afterIntent?.(intent);
    const current = await optionalRegularText(pointer);
    let result: StoreBindingReceipt['result'];
    if (current === binding.pointerDiff.after) {
      result = 'recovered';
    } else {
      if (current !== binding.pointerDiff.before) {
        throw new Error(`Store pointer input drifted: ${binding.repositoryId}`);
      }
      await atomicWriteText(pointer, binding.pointerDiff.after, { containedRoot: repositoryRoot });
      await input.hooks?.afterPointerWrite?.(intent);
      result = 'written';
    }
    receiptFiles.push(
      await persistReceipt(
        journalRoot,
        createStoreBindingReceipt({
          actionId: intent.actionId,
          intentDigest: intent.digest,
          result,
          evidenceDigest: `sha256:${createHash('sha256')
            .update(binding.pointerDiff.after)
            .digest('hex')}`,
          completedAt: input.timestamp,
        }),
        localStateRoot,
      ),
    );
  }
  return receiptFiles;
}

export async function prepareProjectConfigurationDecision(input: {
  workspace: string;
  draftFile: string;
  completedCandidate: unknown;
  requestId?: string;
}): Promise<{ request: ProjectConfigurationDecisionRequest; file: string }> {
  const workspace = await realpath(input.workspace);
  const draftFile = await safeInputFile(workspace, input.workspace, input.draftFile, 'drafts');
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
  await atomicWriteJson(file, state, { containedRoot: workspace });
  await atomicWriteJson(
    draftFile,
    {
      ...draft,
      status: 'awaiting_confirmation',
      candidateConfig: request.candidateConfig,
      reconcile: request.reconcile,
    } satisfies ProjectDetectionDraft,
    { containedRoot: workspace },
  );
  return { request, file };
}

export async function loadPendingProjectConfigurationDecision(
  workspace: string,
  file: string,
): Promise<ProjectConfigurationDecisionRequest> {
  const resolvedWorkspace = await realpath(workspace);
  const stateFile = await safeInputFile(resolvedWorkspace, workspace, file, 'decisions');
  return asStoredDecision(JSON.parse(await readFile(stateFile, 'utf8')) as unknown).request;
}

export async function applyProjectConfigurationDecision(
  input: {
    workspace: string;
    decisionFile: string;
    response: ProjectConfigurationDecisionResponse;
    actor: ProjectConfigurationDecisionActor;
    timestamp: string;
    hooks?: {
      afterIntent?(intent: StoreBindingIntent): Promise<void> | void;
      afterPointerWrite?(intent: StoreBindingIntent): Promise<void> | void;
    };
  },
  registration: OpenSpecStoreRegistrationPort = new OpenSpecStoreRegistration(),
): Promise<ProjectConfigurationApplyResult> {
  const workspace = await realpath(input.workspace);
  const stateFile = await safeInputFile(
    workspace,
    input.workspace,
    input.decisionFile,
    'decisions',
  );
  const state = asStoredDecision(JSON.parse(await readFile(stateFile, 'utf8')) as unknown);
  const record = recordProjectConfigurationDecision({
    request: state.request,
    response: input.response,
    actor: input.actor,
    timestamp: state.record?.decidedAt ?? input.timestamp,
  });
  if (record.decision === 'approve' && state.request.storeBinding?.workspaceRoot !== workspace) {
    throw new Error('Approved Store binding belongs to another Workspace checkout');
  }
  if (state.status === 'confirmed' && state.result) {
    if (
      !state.record ||
      state.record.actorId !== record.actorId ||
      state.record.decision !== record.decision
    ) {
      throw new Error('Project configuration replay does not match the trusted decision');
    }
    return structuredClone(state.result);
  }
  if (record.decision !== 'approve') {
    await atomicWriteJson(
      stateFile,
      { ...state, status: record.decision === 'reject' ? 'rejected' : 'request_changes', record },
      { containedRoot: workspace },
    );
    return {
      status: record.decision === 'reject' ? 'rejected' : 'request_changes',
      configFile: null,
      configDigest: null,
      bindingReceiptFiles: [],
    };
  }

  if (
    state.record &&
    (state.record.actorId !== record.actorId || state.record.decision !== 'approve')
  ) {
    throw new Error('Project configuration apply actor does not match the trusted decision');
  }

  const current = await optionalCurrentConfig(workspace);
  const currentDigest = current ? hashProjectConfig(current) : null;
  if (
    currentDigest !== state.request.baseConfigDigest &&
    currentDigest !== state.request.candidateConfigDigest
  ) {
    throw new Error('Shared project configuration changed while awaiting confirmation');
  }
  const candidateDigest = hashProjectConfig(state.request.candidateConfig);
  if (candidateDigest !== state.request.candidateConfigDigest) {
    throw new Error('Approved project configuration no longer matches its digest');
  }
  const configFile = path.join(workspace, 'repoctopus.yaml');
  const draftFile = await safeInputFile(
    workspace,
    input.workspace,
    path.join(workspace, '.repoctopus', 'drafts', `project-detect-${state.request.draftId}.json`),
    'drafts',
  );
  const draft = asDraft(JSON.parse(await readFile(draftFile, 'utf8')) as unknown);
  if (state.request.storeBinding?.repositories.some((binding) => binding.selection === 'blocked')) {
    throw new Error('Approved Store binding still contains blocked repository conflicts');
  }
  await atomicWriteJson(
    stateFile,
    { ...state, status: 'applying', record },
    { containedRoot: workspace },
  );
  const receiptFiles = state.request.storeBinding
    ? await applyStoreBinding({
        workspace,
        requestId: state.request.requestId,
        candidate: state.request.candidateConfig,
        proposal: state.request.storeBinding,
        timestamp: input.timestamp,
        registration,
        ...(input.hooks ? { hooks: input.hooks } : {}),
      })
    : [];
  if (currentDigest !== candidateDigest) {
    await atomicWriteText(configFile, stringify(state.request.candidateConfig, { lineWidth: 0 }));
  }
  await ensureRepoctopusGitignore(workspace);
  const written = await loadProjectConfig(workspace);
  const writtenDigest = hashProjectConfig(written.shared);
  if (writtenDigest !== candidateDigest) {
    throw new Error('Written project configuration does not match the approved digest');
  }
  await atomicWriteJson(
    draftFile,
    { ...draft, status: 'confirmed' } satisfies ProjectDetectionDraft,
    { containedRoot: workspace },
  );
  const result: ProjectConfigurationApplyResult = {
    status: 'confirmed',
    configFile,
    configDigest: writtenDigest,
    bindingReceiptFiles: receiptFiles,
  };
  await atomicWriteJson(
    stateFile,
    { ...state, status: 'confirmed', record, result },
    { containedRoot: workspace },
  );
  return result;
}
