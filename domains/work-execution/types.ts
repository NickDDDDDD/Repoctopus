import { createHash } from 'node:crypto';

import type { ActionIntent, ClaimedActionOutcome } from '../action/types.js';
import type { WorkExecutionContext } from '../change-lifecycle/work-context.js';
import type { WorkDescriptor } from '../change-lifecycle/transition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export type WorkContinuationKind = 'execute' | 'ask' | 'wait' | 'reconcile' | 'done';

export interface WorkExecutionRecovery {
  schemaVersion: 2;
  continuation: WorkContinuationKind;
  workId: string | null;
  attempt: number | null;
  checkEpoch: number | null;
  reason:
    | 'terminal'
    | 'human-decision'
    | 'work-unclaimed'
    | 'claim-redelivery'
    | 'host-active'
    | 'host-result-unknown'
    | 'host-not-executed'
    | 'work-failed'
    | 'validator-pending'
    | 'transition-pending'
    | 'content-missing-or-corrupt'
    | 'project-drift';
}

export interface AgentCoordinationCheckpoint {
  schemaVersion: 2;
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  observedStateVersion: number;
  currentTask: string | null;
  observedPaths: readonly string[];
  progress: readonly string[];
  updatedAt: string;
}

export interface AgentCoordinationCheckpointView {
  status: 'missing' | 'current' | 'stale';
  checkpoint: AgentCoordinationCheckpoint | null;
}

export interface WorkExecutionPacketIdentity {
  schemaVersion: 1;
  packetId: `sha256:${string}`;
  packetDigest: `sha256:${string}`;
  contextDigest: `sha256:${string}`;
}

export interface WorkExecutionHostRequirement {
  schemaVersion: 1;
  actionKind: 'agent';
  capabilities: readonly string[];
  sideEffectClass: WorkDescriptor['sideEffectClass'];
}

export interface WorkExecutionPacket {
  schemaVersion: 2;
  identity: WorkExecutionPacketIdentity;
  claim: Readonly<
    Pick<
      ActionIntent,
      | 'intentId'
      | 'runId'
      | 'workId'
      | 'attempt'
      | 'checkEpoch'
      | 'claimToken'
      | 'inputDigest'
      | 'compositionDigest'
    >
  >;
  work: Readonly<WorkDescriptor>;
  context: Readonly<WorkExecutionContext>;
  hostRequirement: WorkExecutionHostRequirement;
}

export interface WorkClaimResult {
  intent: ActionIntent;
  packet: WorkExecutionPacket;
}

export interface WorkExecutionHostIdentity {
  schemaVersion: 1;
  id: string;
  version: string;
  codeDigest: `sha256:${string}`;
  capabilities: readonly string[];
  actionKinds: readonly WorkExecutionHostRequirement['actionKind'][];
  reconcile: boolean;
}

export interface WorkExecutionSessionIdentity {
  schemaVersion: 2;
  sessionId: string;
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  invocationId: string;
  packetDigest: `sha256:${string}`;
}

export interface WorkExecutionHostInvocation {
  schemaVersion: 1;
  invocationId: string;
  host: WorkExecutionHostIdentity;
  packet: WorkExecutionPacketIdentity;
  startedAt: string;
}

export interface WorkExecutionHostOutcome {
  schemaVersion: 1;
  invocationId: string;
  hostId: string;
  packetDigest: `sha256:${string}`;
  status: 'succeeded' | 'failed' | 'unknown';
  summary: string;
  consumedLayerDigests: readonly `sha256:${string}`[];
  findings?: readonly WorkExecutionFinding[];
  completedAt: string;
}

export type WorkExecutionFindingKind =
  | 'implementation_failure'
  | 'design_assumption_invalid'
  | 'planning_semantics_changed'
  | 'evidence_unavailable'
  | 'external_result_unknown';

export interface WorkExecutionFinding {
  kind: WorkExecutionFindingKind;
  summary: string;
  requirementIds?: readonly string[];
  taskIds?: readonly string[];
}

export type WorkExecutionHostReconciliation =
  | { status: 'executed'; outcome: WorkExecutionHostOutcome }
  | { status: 'not-executed'; reason: string }
  | { status: 'unknown'; reason: string };

export interface ExternalWorkExecutionOutcome {
  schemaVersion: 2;
  runId: string;
  invocationId: string;
  hostId: string;
  packetDigest: `sha256:${string}`;
  status: WorkExecutionHostOutcome['status'];
  summary: string;
  consumedLayerDigests: readonly `sha256:${string}`[];
  findings?: readonly WorkExecutionFinding[];
}

export interface WorkExecutionCheckpoint {
  schemaVersion: 2;
  workId: string;
  attempt: number;
  checkEpoch: number;
  intentId: string;
  claimToken: `sha256:${string}`;
  inputDigest: `sha256:${string}`;
  packet: WorkExecutionPacketIdentity;
  status:
    | 'claimed'
    | 'context-delivered'
    | 'invoking'
    | 'unknown'
    | 'not-executed'
    | 'outcome'
    | 'validated';
  hostInvocation?: WorkExecutionHostInvocation;
  hostOutcome?: WorkExecutionHostOutcome;
  actionOutcome?: ClaimedActionOutcome;
  receiptId?: string;
  validatorId?: string;
  continuation: WorkContinuationKind;
  updatedAt: string;
}

export interface WorkExecutionHostPreflight {
  accepted: boolean;
  reason?: string;
}

export interface WorkExecutionHost {
  readonly identity: WorkExecutionHostIdentity;
  preflight(packet: WorkExecutionPacket): Promise<WorkExecutionHostPreflight>;
  invoke(
    packet: WorkExecutionPacket,
    session: WorkExecutionSessionIdentity,
  ): Promise<WorkExecutionHostOutcome>;
  reconcile?(invocation: WorkExecutionHostInvocation): Promise<WorkExecutionHostReconciliation>;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function createWorkExecutionPacket(input: {
  intent: ActionIntent;
  work: WorkDescriptor;
  context: WorkExecutionContext;
}): WorkExecutionPacket {
  if (input.context.workId !== input.work.workId) {
    throw new Error('Work execution context belongs to another Work');
  }
  if (input.context.digest !== input.intent.executionContext?.digest) {
    throw new Error('Work execution context digest does not match the persisted intent identity');
  }
  const claim: WorkExecutionPacket['claim'] = {
    intentId: input.intent.intentId,
    runId: input.intent.runId,
    workId: input.intent.workId,
    attempt: input.intent.attempt,
    checkEpoch: input.intent.checkEpoch,
    claimToken: input.intent.claimToken,
    inputDigest: input.intent.inputDigest,
    compositionDigest: input.intent.compositionDigest,
  };
  const hostRequirement: WorkExecutionHostRequirement = {
    schemaVersion: 1,
    actionKind: 'agent',
    capabilities: [...input.work.capabilities].sort(),
    sideEffectClass: input.work.sideEffectClass,
  };
  const stable = {
    schemaVersion: 2 as const,
    claim,
    work: structuredClone(input.work),
    context: structuredClone(input.context),
    hostRequirement,
  };
  const packetDigest = sha256(canonicalJson(stable));
  const packet: WorkExecutionPacket = {
    ...stable,
    identity: {
      schemaVersion: 1,
      packetId: sha256(`work-execution-packet\0${packetDigest}`),
      packetDigest,
      contextDigest: input.context.digest,
    },
  };
  return deepFreeze(packet);
}

export function assertPacketIdentity(packet: WorkExecutionPacket): void {
  const rebuilt = createWorkExecutionPacket({
    intent: {
      schemaVersion: 3,
      ...packet.claim,
      idempotencyKey: 'packet-verification',
      composition: {
        id: 'packet-verification',
        kind: 'project',
        compositionDigest: packet.claim.compositionDigest as `sha256:${string}`,
        plugins: [],
      },
      action: {
        id: packet.claim.workId,
        stepId: packet.work.phase,
        type: 'invoke_skill',
        ref: packet.work.kind,
        summary: 'packet verification',
      },
      adapter: 'packet-verification',
      executionContext: {
        digest: packet.context.digest,
        layers: packet.context.layers.map(({ kind, priority, source, digest }) => ({
          kind,
          priority,
          source,
          digest,
        })),
      },
      createdAt: '',
    },
    work: packet.work,
    context: packet.context,
  });
  if (rebuilt.identity.packetDigest !== packet.identity.packetDigest) {
    throw new Error('Work execution packet identity does not match its content');
  }
}
