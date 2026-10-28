import { createHash } from 'node:crypto';

import { CHANGE_PHASES, type ChangePhase } from '../change-lifecycle/transition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { TrajectoryEvent } from './types.js';

export const OBSERVATION_SCHEMA_VERSION = 1 as const;

export type { ChangePhase } from '../change-lifecycle/transition.js';
export type ObservationBuildAction = 'configure' | 'plan' | 'plan-evidence' | 'execute' | 'check';
export type ContinuationKind = 'execute' | 'ask' | 'wait' | 'reconcile' | 'done';
export type ObservationScalar = string | number | boolean;

export interface ObservationContext {
  workspaceId?: string;
  changeId?: string;
  workflowName?: string;
  workflowVersion?: string;
}

export interface ObservationCorrelation {
  workspaceId?: string;
  changeId?: string;
  phase?: ChangePhase;
  buildAction?: ObservationBuildAction;
  workId?: string;
  workKind?: string;
  packageId?: string;
  taskId?: string;
  taskRevision?: string;
  attempt?: number;
  hostId?: string;
  validatorId?: string;
  continuation?: ContinuationKind;
  skillName?: string;
  skillRole?: 'action' | 'augmentation';
  decisionId?: string;
  decisionKind?: string;
  evidenceAttemptId?: string;
  recovery?: string;
}

export interface ObservationEnvelope {
  schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  envelopeId: `sha256:${string}`;
  digest: `sha256:${string}`;
  observedAt: string;
  eventType: TrajectoryEvent['type'];
  identity: {
    eventId: string;
    runId: string;
    sequence: number;
  };
  correlation: ObservationCorrelation;
  attributes: Readonly<Record<string, ObservationScalar>>;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PHASES = new Set<ChangePhase>(CHANGE_PHASES);
const BUILD_ACTIONS = new Set<ObservationBuildAction>([
  'configure',
  'plan',
  'plan-evidence',
  'execute',
  'check',
]);
const CONTINUATIONS = new Set<ContinuationKind>(['execute', 'ask', 'wait', 'reconcile', 'done']);
const ATTRIBUTE_KEYS = [
  'result',
  'checkEpoch',
  'stateVersion',
  'planRevision',
  'findingCount',
  'findingKind',
  'executionMode',
  'tddMode',
  'reviewMode',
  'isolation',
  'recoveredTransition',
] as const;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function id(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) return undefined;
  if (value.includes('://') || value.includes('..') || value.includes('\\')) return undefined;
  if (/^[A-Za-z]:\//u.test(value) || value.startsWith('/')) return undefined;
  return value;
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function scalar(value: unknown): ObservationScalar | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.length > 256) return undefined;
  if (
    /(bearer\s+|gh[opusr]_|private key|password|secret-token|authorization|cookie)/iu.test(value) ||
    value.includes('\\') ||
    /^[A-Za-z]:\//u.test(value) ||
    value.startsWith('/')
  ) {
    return undefined;
  }
  return value;
}

function phase(value: unknown): ChangePhase | undefined {
  return typeof value === 'string' && PHASES.has(value as ChangePhase)
    ? (value as ChangePhase)
    : undefined;
}

function buildAction(value: unknown): ObservationBuildAction | undefined {
  return typeof value === 'string' && BUILD_ACTIONS.has(value as ObservationBuildAction)
    ? (value as ObservationBuildAction)
    : undefined;
}

function continuation(value: unknown): ContinuationKind | undefined {
  return typeof value === 'string' && CONTINUATIONS.has(value as ContinuationKind)
    ? (value as ContinuationKind)
    : undefined;
}

function nestedTransition(event: TrajectoryEvent) {
  const value = event.data.changeLifecycleTransition;
  return value && typeof value === 'object' ? value : undefined;
}

function correlation(event: TrajectoryEvent, context: ObservationContext): ObservationCorrelation {
  const transition = nestedTransition(event);
  const target = transition?.to;
  const work = transition?.work;
  const wait = transition?.wait;
  const result: ObservationCorrelation = {};
  const assign = <Key extends keyof ObservationCorrelation>(
    key: Key,
    value: ObservationCorrelation[Key] | undefined,
  ) => {
    if (value !== undefined) result[key] = value;
  };

  assign('workspaceId', id(context.workspaceId));
  assign('changeId', id(context.changeId));
  assign('phase', phase(event.data.phase) ?? phase(target?.phase));
  assign('buildAction', buildAction(event.data.buildAction));
  assign('workId', id(event.data.workId) ?? id(work?.workId));
  assign('workKind', id(event.data.workKind) ?? id(work?.kind));
  assign('packageId', id(event.data.packageId));
  assign('taskId', id(event.data.taskId) ?? id(work?.taskId));
  assign('taskRevision', id(event.data.taskRevision));
  assign('attempt', integer(event.data.attempt));
  assign('hostId', id(event.data.hostId));
  assign('validatorId', id(event.data.validatorId) ?? id(work?.validatorProfile?.id));
  assign('continuation', continuation(event.data.continuation));
  assign('skillName', id(event.data.skillName));
  const role = event.data.skillRole;
  assign('skillRole', role === 'action' || role === 'augmentation' ? role : undefined);
  const waitKind = id(event.data.waitKind) ?? id(wait?.kind);
  assign(
    'decisionId',
    id(event.data.decisionId) ??
      (waitKind === 'human-decision' ? (id(event.data.waitId) ?? id(wait?.waitId)) : undefined),
  );
  assign('decisionKind', id(event.data.decisionKind) ?? waitKind);
  assign('evidenceAttemptId', id(event.data.evidenceAttemptId));
  assign(
    'recovery',
    id(event.data.recovery) ??
      (event.type === 'recovery.reconciled' || event.type === 'run.resumed'
        ? event.type
        : undefined),
  );
  return result;
}

function attributes(event: TrajectoryEvent, context: ObservationContext) {
  const result: Record<string, ObservationScalar> = {};
  const workflowName = scalar(context.workflowName);
  const workflowVersion = scalar(context.workflowVersion);
  if (workflowName !== undefined) result.workflowName = workflowName;
  if (workflowVersion !== undefined) result.workflowVersion = workflowVersion;
  result.stateVersion = event.stateVersion;
  if (DIGEST.test(event.compositionDigest)) result.compositionDigest = event.compositionDigest;
  for (const key of ATTRIBUTE_KEYS) {
    const value = scalar(event.data[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** Maps one persisted Runtime fact into the only canonical observation representation. */
export function createObservationEnvelope(
  event: TrajectoryEvent,
  context: ObservationContext = {},
): ObservationEnvelope {
  const payload = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observedAt: event.timestamp,
    eventType: event.type,
    identity: { eventId: event.eventId, runId: event.runId, sequence: event.sequence },
    correlation: correlation(event, context),
    attributes: attributes(event, context),
  } as const;
  const envelopeId = digest({
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
  });
  return { ...payload, envelopeId, digest: digest({ ...payload, envelopeId }) };
}

export function isObservationEnvelope(value: unknown): value is ObservationEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schemaVersion !== OBSERVATION_SCHEMA_VERSION ||
    typeof envelope.envelopeId !== 'string' ||
    !DIGEST.test(envelope.envelopeId) ||
    typeof envelope.digest !== 'string' ||
    !DIGEST.test(envelope.digest) ||
    typeof envelope.observedAt !== 'string' ||
    typeof envelope.eventType !== 'string'
  ) {
    return false;
  }
  const identity = envelope.identity as Record<string, unknown> | undefined;
  return (
    identity !== undefined &&
    id(identity.eventId) !== undefined &&
    id(identity.runId) !== undefined &&
    integer(identity.sequence) !== undefined &&
    typeof envelope.correlation === 'object' &&
    envelope.correlation !== null &&
    typeof envelope.attributes === 'object' &&
    envelope.attributes !== null
  );
}
