import { createHash } from 'node:crypto';

import { CHANGE_PHASES, type ChangePhase } from '../change-lifecycle/transition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { DeliveryEvent } from '../delivery/ports.js';
import type { EvidenceTelemetryBatch } from '../evidence/telemetry.js';
import type { TrajectoryEvent } from './types.js';

export const OBSERVATION_SCHEMA_VERSION = 1 as const;

export type { ChangePhase } from '../change-lifecycle/transition.js';
export type ObservationBuildAction = 'configure' | 'plan' | 'plan-evidence' | 'execute' | 'check';
export type ContinuationKind = 'execute' | 'reobserve' | 'ask' | 'wait' | 'reconcile' | 'done';
export type ObservationScalar = string | number | boolean;
export type ObservationSkillRole =
  | 'action'
  | 'augmentation'
  | 'builtin-augmentation'
  | 'team-guidance'
  | 'team-replacement';

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
  skillRole?: ObservationSkillRole;
  ruleId?: string;
  ruleDigest?: string;
  evaluatorId?: string;
  evaluatorVersion?: string;
  bindingId?: string;
  strategyId?: string;
  strategyRevision?: number;
  bindingRevision?: number;
  slotId?: string;
  skillOrder?: number;
  replacedSkillName?: string;
  skillCompositionDigest?: string;
  decisionId?: string;
  decisionKind?: string;
  evidenceAttemptId?: string;
  recovery?: string;
  invocationId?: string;
  parentWorkId?: string;
  receiptId?: string;
  artifactId?: string;
  gateId?: string;
  destinationId?: string;
}

export interface ObservationEnvelope {
  schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  envelopeId: `sha256:${string}`;
  digest: `sha256:${string}`;
  observedAt: string;
  eventType: string;
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
const CONTINUATIONS = new Set<ContinuationKind>([
  'execute',
  'reobserve',
  'ask',
  'wait',
  'reconcile',
  'done',
]);
export const OBSERVATION_ATTRIBUTE_KEYS = [
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
  'actionType',
  'decision',
  'gateStatus',
  'outcome',
  'status',
  'artifactType',
  'artifactSize',
  'mediaType',
  'redacted',
  'platform',
  'lifecycle',
  'transitionId',
  'fromPhase',
  'fromStatus',
  'toStatus',
  'revision',
  'freshness',
  'destinationId',
  'destinationMode',
  'destinationResult',
  'backlog',
  'oldestAgeMs',
  'warningCode',
  'droppedEnvelopes',
  'targetKind',
  'proposalStatus',
  'specsStatus',
  'designStatus',
  'tasksStatus',
  'valid',
  'highestSeverity',
  'infoCount',
  'warningCount',
  'errorCount',
  'contractConflict',
  'reasonCode',
  'changedSkillCount',
  'strategyRevision',
  'bindingRevision',
  'decisionStatus',
  'reasonClass',
  'buildEvent',
  'skillCategory',
  'ruleCategory',
  'ruleApplicable',
  'ruleExpected',
  'ruleTriggered',
  'ruleResult',
  'workflowName',
  'workflowVersion',
  'workflowRunResult',
  'workflowRunDurationMs',
  'durationMs',
  'correctionKind',
  'deliveryState',
  'reason',
] as const;

const DESKTOP_ACTIVATION_REASONS = new Set([
  'new-instance',
  'existing-instance',
  'target-unavailable',
  'development-artifact-missing',
  'protocol-handler-unavailable',
  'launch-rejected',
  'launch-timeout',
  'platform-unsupported',
]);

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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inferredBuildAction(event: TrajectoryEvent): ObservationBuildAction | undefined {
  const explicit = buildAction(event.data.buildAction);
  if (explicit) return explicit;
  const workKind = id(event.data.workKind);
  if (workKind?.startsWith('build.')) {
    const candidate = workKind.slice('build.'.length);
    return buildAction(candidate === 'configure' ? 'configure' : candidate);
  }
  const observationKind = id(event.data.observationKind);
  if (!observationKind) return undefined;
  if (observationKind.includes('plan-evidence')) return 'plan-evidence';
  if (observationKind.includes('configuration') || observationKind.includes('binding')) {
    return 'configure';
  }
  if (observationKind.includes('package')) return 'execute';
  if (observationKind.includes('check')) return 'check';
  if (observationKind.includes('plan')) return 'plan';
  return undefined;
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
  assign('buildAction', inferredBuildAction(event));
  assign('workId', id(event.data.workId) ?? id(work?.workId));
  assign('workKind', id(event.data.workKind) ?? id(work?.kind));
  const observation = record(event.data.observation);
  const buildProtocol = record(observation?.buildProtocol);
  const strategy = record(observation?.strategy) ?? record(buildProtocol?.strategy);
  const binding = record(observation?.binding) ?? record(buildProtocol?.binding);
  const invalidation = record(observation?.invalidation);
  const completion = record(observation?.completion);
  assign(
    'packageId',
    id(event.data.packageId) ?? id(invalidation?.packageId) ?? id(completion?.packageId),
  );
  assign('taskId', id(event.data.taskId) ?? id(work?.taskId));
  assign('taskRevision', id(event.data.taskRevision));
  assign('attempt', integer(event.data.attempt));
  assign('hostId', id(event.data.hostId));
  assign('validatorId', id(event.data.validatorId) ?? id(work?.validatorProfile?.id));
  assign('continuation', continuation(event.data.continuation));
  assign('skillName', id(event.data.skillName));
  const role = event.data.skillRole;
  assign(
    'skillRole',
    role === 'action' ||
      role === 'augmentation' ||
      role === 'builtin-augmentation' ||
      role === 'team-guidance' ||
      role === 'team-replacement'
      ? role
      : undefined,
  );
  assign('ruleId', id(event.data.ruleId));
  assign(
    'ruleDigest',
    typeof event.data.ruleDigest === 'string' && DIGEST.test(event.data.ruleDigest)
      ? event.data.ruleDigest
      : undefined,
  );
  assign('evaluatorId', id(event.data.evaluatorId));
  assign('evaluatorVersion', id(event.data.evaluatorVersion));
  assign('strategyId', id(event.data.strategyId) ?? id(strategy?.strategyId));
  assign('strategyRevision', integer(event.data.strategyRevision) ?? integer(strategy?.revision));
  assign('bindingId', id(event.data.bindingId) ?? id(binding?.bindingId));
  assign('bindingRevision', integer(event.data.bindingRevision) ?? integer(binding?.revision));
  assign('slotId', id(event.data.slotId));
  assign('skillOrder', integer(event.data.skillOrder));
  assign('replacedSkillName', id(event.data.replacedSkillName));
  assign(
    'skillCompositionDigest',
    typeof event.data.skillCompositionDigest === 'string' &&
      DIGEST.test(event.data.skillCompositionDigest)
      ? event.data.skillCompositionDigest
      : undefined,
  );
  const waitKind = id(event.data.waitKind) ?? id(wait?.kind);
  assign(
    'decisionId',
    id(event.data.decisionId) ??
      (waitKind === 'human-decision' ? (id(event.data.waitId) ?? id(wait?.waitId)) : undefined),
  );
  assign('decisionKind', id(event.data.decisionKind) ?? waitKind);
  assign('evidenceAttemptId', id(event.data.evidenceAttemptId));
  assign('invocationId', id(event.data.invocationId));
  assign('parentWorkId', id(event.data.parentWorkId));
  assign('receiptId', id(event.data.receiptId));
  assign('artifactId', id(event.data.artifactId));
  assign('gateId', id(event.data.gateId));
  assign('destinationId', id(event.data.destinationId));
  assign(
    'recovery',
    id(event.data.recovery) ??
      (event.type === 'recovery.reconciled' ||
      event.type === 'run.resumed' ||
      event.type === 'work.packet-recovered'
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
  for (const key of OBSERVATION_ATTRIBUTE_KEYS) {
    if (key === 'reason') continue;
    const value = scalar(event.data[key]);
    if (value !== undefined) result[key] = value;
  }
  if (
    event.type === 'desktop.activation' &&
    typeof event.data.reason === 'string' &&
    DESKTOP_ACTIVATION_REASONS.has(event.data.reason)
  ) {
    result.reason = event.data.reason;
  }
  const observationKind = scalar(event.data.observationKind);
  if (observationKind !== undefined) result.observationKind = observationKind;
  const observation = record(event.data.observation);
  const invalidation = record(observation?.invalidation);
  const findingKind = scalar(invalidation?.classification);
  if (findingKind !== undefined) result.findingKind = findingKind;
  const observationKindValue = event.data.observationKind;
  const buildEvent =
    observationKindValue === 'build-binding-accepted'
      ? 'build.binding.validated'
      : observationKindValue === 'build-binding-revalidation-required'
        ? 'build.binding.drifted'
        : observationKindValue === 'build-binding-retry-required'
          ? 'build.binding.rejected'
          : observationKindValue === 'build-plan-evidence-accepted'
            ? 'build.plan.preflight.accepted'
            : observationKindValue === 'build-plan-retry-required'
              ? 'build.plan.preflight.rejected'
              : undefined;
  if (buildEvent) result.buildEvent = buildEvent;
  const reasonClass = scalar(observation?.reasonCode);
  if (
    typeof reasonClass === 'string' &&
    ['host', 'capability', 'checkout', 'head', 'path'].includes(reasonClass)
  ) {
    result.reasonClass = reasonClass;
  }
  if (event.type === 'wait.started' && event.data.waitKind === 'human-decision') {
    result.decisionStatus = 'created';
  } else if (event.type === 'wait.ended' && event.data.waitKind === 'human-decision') {
    result.decisionStatus = 'resolved';
  }
  if (event.type.startsWith('skill.')) result.skillState = event.type.slice('skill.'.length);
  const transition = nestedTransition(event);
  const transitionId = scalar(transition?.transitionId);
  const fromPhase = scalar(transition?.from?.phase);
  const fromStatus = scalar(transition?.from?.status);
  const toStatus = scalar(transition?.to?.status);
  const revision = scalar(transition?.revision);
  if (transitionId !== undefined) result.transitionId = transitionId;
  if (fromPhase !== undefined) result.fromPhase = fromPhase;
  if (fromStatus !== undefined) result.fromStatus = fromStatus;
  if (toStatus !== undefined) result.toStatus = toStatus;
  if (revision !== undefined) result.revision = revision;
  return result;
}

function canonicalEnvelope(input: {
  eventId: string;
  runId: string;
  sequence: number;
  observedAt: string;
  eventType: string;
  correlation?: ObservationCorrelation;
  attributes?: Readonly<Record<string, ObservationScalar>>;
}): ObservationEnvelope {
  const payload = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observedAt: input.observedAt,
    eventType: input.eventType,
    identity: { eventId: input.eventId, runId: input.runId, sequence: input.sequence },
    correlation: input.correlation ?? {},
    attributes: input.attributes ?? {},
  } as const;
  const envelopeId = digest({
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    eventId: input.eventId,
    runId: input.runId,
    sequence: input.sequence,
  });
  return { ...payload, envelopeId, digest: digest({ ...payload, envelopeId }) };
}

/** Maps one persisted Runtime fact into the only canonical observation representation. */
export function createObservationEnvelope(
  event: TrajectoryEvent,
  context: ObservationContext = {},
): ObservationEnvelope {
  return canonicalEnvelope({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    observedAt: event.timestamp,
    eventType: event.type,
    correlation: correlation(event, context),
    attributes: attributes(event, context),
  });
}

function safeAttributes(
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, ObservationScalar>> {
  const result: Record<string, ObservationScalar> = {};
  for (const key of keys) {
    const value = scalar(source[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** Maps durable Evidence facts without exposing artifact paths or report bodies. */
export function createEvidenceObservationEnvelopes(
  batch: EvidenceTelemetryBatch,
  context: ObservationContext = {},
): readonly ObservationEnvelope[] {
  return batch.events.map((event) => {
    const workspaceId = id(context.workspaceId);
    const changeId = id(context.changeId);
    const receiptId = id(event.data.receiptId);
    const artifactId = id(event.data.artifactDigest);
    const gateId = id(event.data.bundleId);
    const correlation: ObservationCorrelation = {
      ...(workspaceId ? { workspaceId } : {}),
      ...(changeId ? { changeId } : {}),
      evidenceAttemptId: event.attemptId,
      ...(receiptId ? { receiptId } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(gateId ? { gateId } : {}),
    };
    return canonicalEnvelope({
      eventId: event.eventId,
      runId: event.runId ?? `evidence:${event.attemptId}`,
      sequence: event.sequence,
      observedAt: event.timestamp,
      eventType: event.type,
      correlation,
      attributes: safeAttributes(event.data, [
        'adapter',
        'artifactType',
        'artifactSize',
        'durationMs',
        'freshness',
        'gateStatus',
        'mediaType',
        'outcome',
        'redacted',
        'sourceReceiptId',
        'status',
        'trust',
      ]),
    });
  });
}

/** Maps lightweight delivery/archive facts; merge automation and webhook state are intentionally absent. */
export function createDeliveryObservationEnvelope(
  event: DeliveryEvent,
  context: ObservationContext = {},
  state?: { status: string },
): ObservationEnvelope {
  const workspaceId = id(context.workspaceId);
  return canonicalEnvelope({
    eventId: event.eventId,
    runId: `delivery:${event.changeId}`,
    sequence: event.stateVersion,
    observedAt: event.timestamp,
    eventType: event.type,
    correlation: {
      ...(workspaceId ? { workspaceId } : {}),
      changeId: event.changeId,
    },
    attributes: {
      ...safeAttributes(event.data, [
        'actionType',
        'decision',
        'mergedCount',
        'mergeRequestCount',
        'repositoryCount',
        'result',
      ]),
      ...(scalar(state?.status) === undefined ? {} : { deliveryState: scalar(state?.status)! }),
    },
  });
}

/** Creates allowlisted application/platform lifecycle observations for the same OTLP pipeline. */
export function createApplicationObservationEnvelope(input: {
  eventId: string;
  runId: string;
  observedAt: string;
  eventType: `application.${string}` | `platform.${string}` | `archive.${string}`;
  context?: ObservationContext;
  attributes?: Readonly<Record<string, unknown>>;
}): ObservationEnvelope {
  if (/webhook|post[_-]?merge|merge[_-]?wait/iu.test(input.eventType)) {
    throw new Error('Legacy merge automation is not an observation lifecycle');
  }
  const workspaceId = id(input.context?.workspaceId);
  const changeId = id(input.context?.changeId);
  return canonicalEnvelope({
    eventId: input.eventId,
    runId: input.runId,
    sequence: 0,
    observedAt: input.observedAt,
    eventType: input.eventType,
    correlation: {
      ...(workspaceId ? { workspaceId } : {}),
      ...(changeId ? { changeId } : {}),
    },
    attributes: safeAttributes(input.attributes ?? {}, [
      'platform',
      'lifecycle',
      'result',
      'status',
      'bindingError',
      'runCreated',
      'workCreated',
      'checkpointChanged',
      'recovery',
      'hostReplayed',
      'observation',
    ]),
  });
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
