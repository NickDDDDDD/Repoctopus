import type { ActionOutcome, EngineAction } from '../engine/types.js';
import type { CompositionIdentitySnapshot } from '../composition/types.js';

export interface ActionIntent {
  schemaVersion: 1;
  intentId: string;
  idempotencyKey: string;
  runId: string;
  compositionDigest: string;
  composition: CompositionIdentitySnapshot;
  action: EngineAction;
  adapter: string;
  createdAt: string;
}

export interface ActionReceipt {
  schemaVersion: 1;
  receiptId: string;
  intentId: string;
  idempotencyKey: string;
  runId: string;
  compositionDigest: string;
  actionId: string;
  adapter: string;
  outcome: ActionOutcome['status'];
  summary: string;
  completedAt: string;
}

export interface ManualActionResult {
  runId: string;
  actionId: string;
  status: ActionOutcome['status'];
  summary: string;
  eventId: string;
}
