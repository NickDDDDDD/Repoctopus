import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { changeRunId } from './host-workflow.js';
import type { ChangeLifecycleMigrationPlan } from './migration.js';

export interface ChangeLifecycleMigrationRequest {
  schemaVersion: 1;
  plan: ChangeLifecycleMigrationPlan;
  target: {
    workspaceId: string;
    changeId: string;
    generation: number;
  };
  auditReferences: readonly string[];
}

export interface ChangeLifecycleMigrationIntent {
  schemaVersion: 1;
  transactionId: `sha256:${string}`;
  planDigest: `sha256:${string}`;
  legacyIdentity: Readonly<Record<string, string>>;
  targetRunId: string;
  targetGeneration: number;
  auditReferences: readonly string[];
}

export interface ChangeLifecycleMigrationReceipt extends ChangeLifecycleMigrationIntent {
  status: 'applied';
  receiptDigest: `sha256:${string}`;
}

export interface ChangeLifecycleMigrationJournal {
  intent: ChangeLifecycleMigrationIntent;
  receipt?: ChangeLifecycleMigrationReceipt;
}

export interface ChangeLifecycleMigrationStore {
  load(transactionId: string): Promise<ChangeLifecycleMigrationJournal | null>;
  saveIntent(intent: ChangeLifecycleMigrationIntent): Promise<void>;
  saveReceipt(receipt: ChangeLifecycleMigrationReceipt): Promise<void>;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createChangeLifecycleMigrationIntent(
  request: ChangeLifecycleMigrationRequest,
): ChangeLifecycleMigrationIntent {
  if (request.plan.status !== 'migratable') {
    throw new Error(`Migration plan is not applicable: ${request.plan.status}`);
  }
  if (!Number.isSafeInteger(request.target.generation) || request.target.generation < 1) {
    throw new Error('Migration target generation must be a positive safe integer');
  }
  const targetRunId = changeRunId({ ...request.target, mode: 'adopt-existing' });
  const stable = {
    schemaVersion: 1 as const,
    planDigest: request.plan.digest,
    legacyIdentity: structuredClone(request.plan.legacyIdentity),
    targetRunId,
    targetGeneration: request.target.generation,
    auditReferences: [...new Set(request.auditReferences)].sort(),
  };
  return { ...stable, transactionId: sha256(stable) };
}

export async function applyChangeLifecycleMigration(input: {
  request: ChangeLifecycleMigrationRequest;
  store: ChangeLifecycleMigrationStore;
  startOrResumeTargetRun(intent: ChangeLifecycleMigrationIntent): Promise<{ runId: string }>;
}): Promise<ChangeLifecycleMigrationReceipt> {
  const intent = createChangeLifecycleMigrationIntent(input.request);
  const existing = await input.store.load(intent.transactionId);
  if (existing) {
    if (canonicalJson(existing.intent) !== canonicalJson(intent)) {
      throw new Error('Migration transaction identity drifted after Intent persistence');
    }
    if (existing.receipt) return existing.receipt;
  } else {
    await input.store.saveIntent(intent);
  }
  const target = await input.startOrResumeTargetRun(intent);
  if (target.runId !== intent.targetRunId) {
    throw new Error('Migration target Run identity does not match the persisted Intent');
  }
  const unsigned = { ...intent, status: 'applied' as const };
  const receipt = { ...unsigned, receiptDigest: sha256(unsigned) };
  await input.store.saveReceipt(receipt);
  return receipt;
}
