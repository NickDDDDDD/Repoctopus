import type { ActionOutcome, EngineAction } from '../engine/types.js';
import type { CompositionIdentitySnapshot } from '../composition/types.js';

export interface ActionIntent {
  schemaVersion: 3;
  intentId: string;
  idempotencyKey: string;
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  claimToken: `sha256:${string}`;
  inputDigest: `sha256:${string}`;
  compositionDigest: string;
  composition: CompositionIdentitySnapshot;
  action: EngineAction;
  adapter: string;
  executor?: WorkExecutorIdentity;
  executionContext?: WorkExecutionContextIdentity;
  createdAt: string;
}

export interface ActionReceipt {
  schemaVersion: 3;
  receiptId: string;
  intentId: string;
  idempotencyKey: string;
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  claimToken: `sha256:${string}`;
  inputDigest: `sha256:${string}`;
  outcomeId: string;
  compositionDigest: string;
  actionId: string;
  adapter: string;
  executor?: WorkExecutorIdentity;
  outcome: ActionOutcome['status'];
  summary: string;
  completedAt: string;
}

export interface ActionClaimInput {
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  inputDigest: `sha256:${string}`;
  composition: CompositionIdentitySnapshot;
  action: EngineAction;
  adapter?: string;
  executor?: WorkExecutorIdentity;
  executionContext?: WorkExecutionContextIdentity;
}

export interface ClaimedActionOutcome {
  schemaVersion: 2;
  outcomeId: string;
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  claimToken: `sha256:${string}`;
  inputDigest: `sha256:${string}`;
  status: ActionOutcome['status'];
  summary: string;
}

export interface ManualActionResult {
  runId: string;
  actionId: string;
  status: ActionOutcome['status'];
  summary: string;
  eventId: string;
}

export interface WorkClaimRequest {
  runId: string;
  adapter: string;
  attempt?: number;
  executor: WorkExecutorIdentity;
}

export interface WorkExecutorIdentity {
  actorId: string;
  runnerId: string;
  source: 'cli' | 'desktop' | 'runner' | 'api';
  authenticated: boolean;
}

export interface WorkExecutionContextIdentity {
  digest: `sha256:${string}`;
  layers: readonly {
    kind: string;
    priority: number;
    source: string;
    digest: `sha256:${string}`;
  }[];
}

export interface WorkOutcomeAcceptance {
  intent: ActionIntent;
  outcome: ClaimedActionOutcome;
  receipt: ActionReceipt;
  validation: 'pending';
  lifecycleAdvanced: false;
}
