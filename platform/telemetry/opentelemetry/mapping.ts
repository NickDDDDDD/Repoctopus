import type { Attributes } from '@opentelemetry/api';

import type { TelemetryBatch } from '../../../domains/runtime/types.js';
import type { ExecutionContext } from '../../../domains/telemetry/execution-context.js';
import type { TrajectoryEvent } from '../../../domains/trajectory/types.js';
import {
  HOST_TOOL_CATEGORIES,
  HOST_TOOL_RESULTS,
} from '../../../domains/telemetry/host-tool-telemetry.js';

const SAFE_DATA_KEYS = new Set([
  'actionId',
  'result',
  'recoveredTransition',
  'repositoryCount',
  'workflowName',
  'workflowVersion',
]);

const EXECUTION_DATA_KEYS = new Set([
  'intentId',
  'packetDigest',
  'contextDigest',
  'layerCount',
  'continuation',
  'invocationId',
  'hostId',
  'outcomeId',
  'receiptId',
  'validatorId',
  'result',
  'skillRole',
  'skillName',
  'operationKind',
  'operationId',
  'toolKind',
  'toolCategory',
  'observationStatus',
  'callCount',
  'modelVersion',
  'waitId',
  'reconcileId',
  'durationMs',
  'recovery',
  'findingCount',
  'findingKind',
  'validatorFindingKind',
  'phase',
]);

const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|secret|token|api[-_]?key|environment)/i;
const SENSITIVE_VALUE =
  /(bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const ACTION_RECEIPT_ID = /^[a-f0-9]{64}$/u;
const SAFE_DOMAIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const SAFE_EXECUTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EXECUTION_EVENTS = new Set<TrajectoryEvent['type']>([
  'work.created',
  'work.claimed',
  'work.context-delivered',
  'work.host-started',
  'work.host-completed',
  'work.completed',
  'task.started',
  'task.completed',
  'task.failed',
  'task.reopened',
  'decision.requested',
  'decision.resolved',
  'skill.resolved',
  'skill.delivered',
  'skill.consumed',
  'tool.started',
  'tool.completed',
  'tool.observation-reported',
  'tool.usage-reported',
  'model.usage-reported',
  'validator.started',
  'validator.completed',
  'wait.started',
  'wait.ended',
  'reconcile.started',
  'reconcile.completed',
  'continuation.selected',
]);
const TELEMETRY_PIPELINE_EVENTS = new Set<TrajectoryEvent['type']>([
  'telemetry.envelope-stored',
  'telemetry.delivery-started',
  'telemetry.delivery-completed',
  'telemetry.receiver-evaluated',
  'telemetry.gap-recorded',
]);

const BOUNDED_DECISION_KINDS = new Set([
  'open-approval',
  'design-approval',
  'adopt-existing',
  'design-revision',
]);
const BOUNDED_WAIT_KINDS = new Set(['human', 'retry', 'external-fact', 'manual-handoff']);
const BOUNDED_TOOL_KINDS = new Set(['runtime-operation', 'host-tool', 'model', 'unknown']);
const BOUNDED_TOOL_CATEGORIES = new Set<string>(HOST_TOOL_CATEGORIES);
const BOUNDED_TOOL_RESULTS = new Set<string>(HOST_TOOL_RESULTS);
const BOUNDED_OBSERVATION_STATUSES = new Set(['observed', 'unknown']);
const MODEL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BOUNDED_DESTINATION_KINDS = new Set(['remote', 'desktop']);
const BOUNDED_PIPELINE_RESULTS = new Set([
  'accepted',
  'rejected',
  'delivered',
  'failed',
  'dropped',
  'gap',
]);

function safeExecutionId(value: string): boolean {
  return (
    SAFE_EXECUTION_ID.test(value) &&
    !value.includes('://') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:\//u.test(value) &&
    !value.startsWith('/')
  );
}

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    if (value.length > 256 || SENSITIVE_VALUE.test(value)) return undefined;
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

type ExecutionContextRead =
  | { status: 'complete'; context: Readonly<ExecutionContext> }
  | { status: 'missing' | 'invalid'; context: null };

function readExecutionContextValue(value: unknown): ExecutionContextRead {
  if (value === undefined) return { status: 'missing', context: null };
  if (!value || typeof value !== 'object') return { status: 'invalid', context: null };
  const record = value as Record<string, unknown>;
  const work = record.work as Record<string, unknown> | undefined;
  const task = record.task as Record<string, unknown> | undefined;
  if (
    record.schemaVersion !== 1 ||
    typeof record.phase !== 'string' ||
    !BOUNDED_PHASES.has(record.phase) ||
    !work ||
    typeof work.id !== 'string' ||
    !safeExecutionId(work.id) ||
    typeof work.kind !== 'string' ||
    !safeExecutionId(work.kind) ||
    typeof record.attempt !== 'number' ||
    !Number.isSafeInteger(record.attempt) ||
    record.attempt < 1 ||
    typeof record.checkEpoch !== 'number' ||
    !Number.isSafeInteger(record.checkEpoch) ||
    record.checkEpoch < 0 ||
    (task !== undefined &&
      (typeof task.id !== 'string' ||
        !safeExecutionId(task.id) ||
        (task.revision !== undefined &&
          (typeof task.revision !== 'string' || !DIGEST.test(task.revision)))))
  ) {
    return { status: 'invalid', context: null };
  }
  return {
    status: 'complete',
    context: {
      schemaVersion: 1,
      phase: record.phase as ExecutionContext['phase'],
      work: { id: work.id, kind: work.kind },
      attempt: record.attempt,
      checkEpoch: record.checkEpoch,
      ...(task
        ? {
            task: {
              id: task.id as string,
              ...(task.revision ? { revision: task.revision as `sha256:${string}` } : {}),
            },
          }
        : {}),
    },
  };
}

export function executionContextFromEvent(
  event: TrajectoryEvent,
): Readonly<ExecutionContext> | null {
  return readExecutionContextValue(event.data.executionContext).context;
}

function addExecutionContextAttributes(attributes: Attributes, event: TrajectoryEvent): void {
  const read = readExecutionContextValue(event.data.executionContext);
  if (!read.context) {
    attributes['repoctopus.execution.context.status'] = read.status;
    return;
  }
  const context = read.context;
  attributes['repoctopus.execution.context.schema_version'] = context.schemaVersion;
  attributes['repoctopus.execution.phase'] = context.phase;
  attributes['repoctopus.execution.work.id'] = context.work.id;
  attributes['repoctopus.execution.work.kind'] = context.work.kind;
  attributes['repoctopus.execution.attempt'] = context.attempt;
  attributes['repoctopus.execution.check_epoch'] = context.checkEpoch;
  if (context.task) {
    attributes['repoctopus.execution.task.id'] = context.task.id;
    attributes['repoctopus.task.id'] = context.task.id;
    if (context.task.revision) {
      attributes['repoctopus.execution.task.revision'] = context.task.revision;
      attributes['repoctopus.task.revision'] = context.task.revision;
    }
  }
}

type ExecutionEntityKind =
  | 'work'
  | 'task'
  | 'skill'
  | 'host'
  | 'tool'
  | 'validator'
  | 'decision'
  | 'wait'
  | 'reconcile';

function safeDataId(event: TrajectoryEvent, key: string): string | undefined {
  const value = event.data[key];
  return typeof value === 'string' && safeExecutionId(value) ? value : undefined;
}

function taskIdentity(event: TrajectoryEvent): { id: string; revision?: string } | null {
  const value = event.data.task;
  if (value && typeof value === 'object') {
    const task = value as Record<string, unknown>;
    if (typeof task.id === 'string' && safeExecutionId(task.id)) {
      return {
        id: task.id,
        ...(typeof task.revision === 'string' && DIGEST.test(task.revision)
          ? { revision: task.revision }
          : {}),
      };
    }
  }
  const context = executionContextFromEvent(event);
  return context?.task ? { ...context.task } : null;
}

function executionEntity(event: TrajectoryEvent): { kind: ExecutionEntityKind; id: string } | null {
  if (event.type.startsWith('work.host-')) {
    const id = safeDataId(event, 'invocationId');
    return id ? { kind: 'host', id } : null;
  }
  if (event.type.startsWith('work.')) {
    const id = executionContextFromEvent(event)?.work.id ?? safeDataId(event, 'workId');
    return id ? { kind: 'work', id } : null;
  }
  if (event.type.startsWith('task.')) {
    const task = taskIdentity(event);
    return task ? { kind: 'task', id: task.id } : null;
  }
  for (const [prefix, kind, key] of [
    ['skill.', 'skill', 'skillName'],
    ['validator.', 'validator', 'validatorId'],
    ['decision.', 'decision', 'decisionId'],
    ['wait.', 'wait', 'waitId'],
    ['tool.', 'tool', 'operationId'],
    ['reconcile.', 'reconcile', 'reconcileId'],
  ] as const) {
    if (!event.type.startsWith(prefix)) continue;
    const id = safeDataId(event, key);
    return id ? { kind, id } : null;
  }
  return null;
}

/** Maps only identities carried by the persisted event or its stable owning Run snapshot. */
export function trustedObservationCorrelationAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Attributes {
  const attributes: Attributes = {};
  if (safeExecutionId(batch.projectSnapshot.projectId)) {
    attributes['repoctopus.workspace.id'] = batch.projectSnapshot.projectId;
  }
  if (safeExecutionId(event.runId)) attributes['repoctopus.run.id'] = event.runId;
  const lifecycleIdentity = batch.run.changeLifecycle?.identity;
  if (
    lifecycleIdentity?.runId === event.runId &&
    lifecycleIdentity.workspaceId === batch.projectSnapshot.projectId &&
    safeExecutionId(lifecycleIdentity.changeId)
  ) {
    attributes['repoctopus.change.id'] = lifecycleIdentity.changeId;
  }
  const observedAt = new Date(event.timestamp);
  if (Number.isFinite(observedAt.getTime())) {
    attributes['repoctopus.observation.observed_at'] = observedAt.toISOString();
  }

  const context = executionContextFromEvent(event);
  const entity = executionEntity(event);
  if (entity) {
    attributes['repoctopus.execution.entity.kind'] = entity.kind;
    attributes['repoctopus.execution.entity.id'] = entity.id;
  }
  if (context && entity?.kind !== 'work') {
    attributes['repoctopus.execution.parent.kind'] = 'work';
    attributes['repoctopus.execution.parent.id'] = context.work.id;
  } else if (
    entity?.kind === 'work' ||
    (!context && entity?.kind === 'decision') ||
    (!context && entity?.kind === 'wait')
  ) {
    attributes['repoctopus.execution.parent.kind'] = 'run';
    attributes['repoctopus.execution.parent.id'] = event.runId;
  }
  const toolInvocationId = event.type.startsWith('tool.')
    ? safeDataId(event, 'invocationId')
    : undefined;
  if (toolInvocationId) {
    attributes['repoctopus.execution.parent.kind'] = 'host';
    attributes['repoctopus.execution.parent.id'] = toolInvocationId;
  }

  if (event.type.startsWith('work.host-')) {
    const hostId = safeDataId(event, 'hostId');
    if (hostId) {
      attributes['repoctopus.executor.kind'] = 'host';
      attributes['repoctopus.executor.id'] = hostId;
    }
  }

  const task = taskIdentity(event);
  if (task) {
    attributes['repoctopus.task.id'] = task.id;
    if (task.revision) attributes['repoctopus.task.revision'] = task.revision;
  }

  if (event.type.startsWith('skill.')) {
    const skillName = safeDataId(event, 'skillName');
    const skillRole = event.data.skillRole;
    if (skillName) attributes['repoctopus.skill.name'] = skillName;
    if (skillRole === 'action' || skillRole === 'augmentation') {
      attributes['repoctopus.skill.role'] = skillRole;
    }
    const state = event.type.slice('skill.'.length);
    if (state === 'resolved' || state === 'delivered' || state === 'consumed') {
      attributes['repoctopus.skill.state'] = state;
    }
  }

  if (event.type.startsWith('validator.')) {
    const validatorId = safeDataId(event, 'validatorId');
    if (validatorId) attributes['repoctopus.validator.id'] = validatorId;
    const result = event.data.result;
    if (typeof result === 'string' && BOUNDED_RESULTS.has(result)) {
      attributes['repoctopus.validator.result'] = result;
    }
  }

  if (event.type === 'decision.requested') {
    const decisionId = safeDataId(event, 'decisionId');
    if (decisionId) {
      attributes['repoctopus.blocker.kind'] = 'human-decision';
      attributes['repoctopus.blocker.id'] = decisionId;
    }
  } else if (event.type === 'wait.started') {
    const waitId = safeDataId(event, 'waitId');
    const waitKind = event.data.waitKind;
    if (waitId && typeof waitKind === 'string' && BOUNDED_WAIT_KINDS.has(waitKind)) {
      attributes['repoctopus.blocker.kind'] = waitKind;
      attributes['repoctopus.blocker.id'] = waitId;
    }
  }

  if (event.type === 'continuation.selected') {
    const continuation = event.data.continuation;
    if (
      typeof continuation === 'string' &&
      ['execute', 'ask', 'wait', 'reconcile', 'done'].includes(continuation)
    ) {
      attributes['repoctopus.next_action.kind'] = continuation;
    }
  }
  return attributes;
}

function addEvidenceCorrelation(attributes: Attributes, event: TrajectoryEvent): void {
  if (event.type !== 'action.completed') return;
  const attemptId = event.data.evidenceAttemptId;
  if (typeof attemptId === 'string' && SAFE_DOMAIN_ID.test(attemptId)) {
    attributes['repoctopus.evidence.attempt.id'] = attemptId;
  }
  const gate = event.data.evidenceGate;
  if (!gate || typeof gate !== 'object') return;
  const record = gate as Record<string, unknown>;
  if (typeof record.bundleId === 'string' && SAFE_DOMAIN_ID.test(record.bundleId)) {
    attributes['repoctopus.evidence.bundle.id'] = record.bundleId;
  }
  if (record.status === 'satisfied' || record.status === 'blocked') {
    attributes['repoctopus.evidence.gate.status'] = record.status;
  }
  if (record.outcome === 'passed' || record.outcome === 'failed') {
    attributes['repoctopus.evidence.outcome'] = record.outcome;
  }
}

function addTaskCorrelation(attributes: Attributes, event: TrajectoryEvent): void {
  if (!event.type.startsWith('task.')) return;
  const task = event.data.task;
  if (task && typeof task === 'object') {
    const record = task as Record<string, unknown>;
    if (typeof record.id === 'string' && safeExecutionId(record.id)) {
      attributes['repoctopus.task.id'] = record.id;
    }
    if (typeof record.revision === 'string' && DIGEST.test(record.revision)) {
      attributes['repoctopus.task.revision'] = record.revision;
    }
  }
  const result = event.data.result;
  if (
    result === 'started' ||
    result === 'completed' ||
    result === 'failed' ||
    result === 'reopened'
  ) {
    attributes['repoctopus.task.result'] = result;
  }
  const recovery = event.data.recovery;
  if (!recovery || typeof recovery !== 'object') return;
  const recoveryRecord = recovery as Record<string, unknown>;
  if (recoveryRecord.kind === 'fallback') {
    attributes['repoctopus.recovery.kind'] = 'fallback';
  }
  if (recoveryRecord.sourcePhase === 'verify' || recoveryRecord.sourcePhase === 'archive') {
    attributes['repoctopus.recovery.source_phase'] = recoveryRecord.sourcePhase;
  }
  const continuation = recoveryRecord.continuation;
  if (!continuation || typeof continuation !== 'object') return;
  const continuationRecord = continuation as Record<string, unknown>;
  const nextWork = continuationRecord.work;
  if (nextWork && typeof nextWork === 'object') {
    const workRecord = nextWork as Record<string, unknown>;
    if (typeof workRecord.id === 'string' && safeExecutionId(workRecord.id)) {
      attributes['repoctopus.recovery.next_work.id'] = workRecord.id;
    }
    if (typeof workRecord.kind === 'string' && safeExecutionId(workRecord.kind)) {
      attributes['repoctopus.recovery.next_work.kind'] = BOUNDED_WORK_KINDS.has(workRecord.kind)
        ? workRecord.kind
        : 'custom';
    }
  }
  if (
    typeof continuationRecord.checkEpoch === 'number' &&
    Number.isSafeInteger(continuationRecord.checkEpoch)
  ) {
    attributes['repoctopus.recovery.next_check_epoch'] = continuationRecord.checkEpoch;
  }
}

function addDecisionCorrelation(attributes: Attributes, event: TrajectoryEvent): void {
  if (event.type.startsWith('decision.')) {
    const decisionId = event.data.decisionId;
    const decisionKind = event.data.decisionKind;
    if (typeof decisionId === 'string' && safeExecutionId(decisionId)) {
      attributes['repoctopus.decision.id'] = decisionId;
    }
    if (typeof decisionKind === 'string' && BOUNDED_DECISION_KINDS.has(decisionKind)) {
      attributes['repoctopus.decision.kind'] = decisionKind;
    }
  }
  if (event.type === 'wait.started' || event.type === 'wait.ended') {
    const waitKind = event.data.waitKind;
    if (typeof waitKind === 'string' && BOUNDED_WAIT_KINDS.has(waitKind)) {
      attributes['repoctopus.wait.kind'] = waitKind;
    }
  }
}

function addHostTelemetryAttributes(attributes: Attributes, event: TrajectoryEvent): void {
  if (
    event.type !== 'tool.observation-reported' &&
    event.type !== 'tool.usage-reported' &&
    event.type !== 'model.usage-reported'
  ) {
    return;
  }
  const toolKind = event.data.toolKind;
  if (typeof toolKind === 'string' && BOUNDED_TOOL_KINDS.has(toolKind)) {
    attributes['repoctopus.tool.kind'] = toolKind;
  }
  const observationStatus = event.data.observationStatus;
  if (
    typeof observationStatus === 'string' &&
    BOUNDED_OBSERVATION_STATUSES.has(observationStatus)
  ) {
    attributes['repoctopus.tool.observation.status'] = observationStatus;
  }
  const category = event.data.toolCategory;
  if (typeof category === 'string' && BOUNDED_TOOL_CATEGORIES.has(category)) {
    attributes['repoctopus.tool.category'] = category;
  }
  const result = event.data.result;
  if (typeof result === 'string' && BOUNDED_TOOL_RESULTS.has(result)) {
    attributes['repoctopus.tool.result'] = result;
  }
  const callCount = event.data.callCount;
  if (typeof callCount === 'number' && Number.isSafeInteger(callCount) && callCount > 0) {
    attributes['repoctopus.tool.call_count'] = callCount;
  }
  const durationMs = event.data.durationMs;
  if (typeof durationMs === 'number' && Number.isSafeInteger(durationMs) && durationMs >= 0) {
    attributes['repoctopus.tool.duration_ms'] = durationMs;
  }
  const modelVersion = event.data.modelVersion;
  if (typeof modelVersion === 'string' && MODEL_VERSION.test(modelVersion)) {
    attributes['repoctopus.model.version'] = modelVersion;
  }
  for (const [source, target] of [
    ['inputTokenCount', 'repoctopus.model.input_token_count'],
    ['outputTokenCount', 'repoctopus.model.output_token_count'],
    ['cacheReadTokenCount', 'repoctopus.model.cache_read_token_count'],
    ['cacheWriteTokenCount', 'repoctopus.model.cache_write_token_count'],
  ] as const) {
    const value = event.data[source];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      attributes[target] = value;
    }
  }
}

function addTelemetryPipelineAttributes(attributes: Attributes, event: TrajectoryEvent): void {
  if (!TELEMETRY_PIPELINE_EVENTS.has(event.type)) return;
  const destinationId = event.data.destinationId;
  if (typeof destinationId === 'string' && safeExecutionId(destinationId)) {
    attributes['repoctopus.telemetry.destination.id'] = destinationId;
  }
  const destinationKind = event.data.destinationKind;
  if (typeof destinationKind === 'string' && BOUNDED_DESTINATION_KINDS.has(destinationKind)) {
    attributes['repoctopus.telemetry.destination.kind'] = destinationKind;
  }
  const operationId = event.data.operationId;
  if (typeof operationId === 'string' && safeExecutionId(operationId)) {
    attributes['repoctopus.telemetry.operation.id'] = operationId;
  }
  const result = event.data.result;
  if (typeof result === 'string' && BOUNDED_PIPELINE_RESULTS.has(result)) {
    attributes['repoctopus.telemetry.result'] = result;
  }
  for (const [source, target] of [
    ['cursorOffset', 'repoctopus.telemetry.cursor.offset'],
    ['headOffset', 'repoctopus.telemetry.head.offset'],
    ['cursorLag', 'repoctopus.telemetry.cursor.lag'],
    ['backlogCount', 'repoctopus.telemetry.backlog.count'],
    ['backlogBytes', 'repoctopus.telemetry.backlog.bytes'],
    ['backlogOldestAgeMs', 'repoctopus.telemetry.backlog.oldest_age_ms'],
    ['retryCount', 'repoctopus.telemetry.retry.count'],
    ['gapCount', 'repoctopus.telemetry.gap.count'],
    ['retentionDroppedCount', 'repoctopus.telemetry.retention.dropped_count'],
    ['retentionDroppedBytes', 'repoctopus.telemetry.retention.dropped_bytes'],
    ['deliveryLatencyMs', 'repoctopus.telemetry.delivery.latency_ms'],
    ['receiverLatencyMs', 'repoctopus.telemetry.receiver.latency_ms'],
    ['droppedCount', 'repoctopus.telemetry.dropped.count'],
    ['droppedBytes', 'repoctopus.telemetry.dropped.bytes'],
  ] as const) {
    const value = event.data[source];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      attributes[target] = value;
    }
  }
  if (typeof event.data.completeHistory === 'boolean') {
    attributes['repoctopus.telemetry.history.complete'] = event.data.completeHistory;
  }
}

export function safeEventAttributes(batch: TelemetryBatch, event: TrajectoryEvent): Attributes {
  const attributes: Attributes = {
    'repoctopus.project.id': batch.projectSnapshot.projectId,
    'repoctopus.run.id': event.runId,
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.workflow.version': batch.run.workflowVersion,
    'repoctopus.workflow.digest': batch.run.workflowDigest,
    'repoctopus.composition.digest': batch.run.composition.compositionDigest,
    'repoctopus.event.id': event.eventId,
    'repoctopus.event.sequence': event.sequence,
    'repoctopus.state.version': event.stateVersion,
    'repoctopus.repository.count': batch.projectSnapshot.repositories.length,
  };
  Object.assign(attributes, trustedObservationCorrelationAttributes(batch, event));

  const action = event.data.action;
  if (action && typeof action === 'object') {
    const actionRecord = action as Record<string, unknown>;
    const type = scalar(actionRecord.type);
    const ref = scalar(actionRecord.ref);
    if (type !== undefined) attributes['repoctopus.action.type'] = type;
    if (ref !== undefined) attributes['repoctopus.action.ref'] = ref;
  }
  for (const [key, value] of Object.entries(event.data)) {
    if (!SAFE_DATA_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const safe = scalar(value);
    if (safe !== undefined) attributes[`repoctopus.event.${key}`] = safe;
  }
  if (EXECUTION_EVENTS.has(event.type)) {
    addExecutionContextAttributes(attributes, event);
    for (const [key, value] of Object.entries(event.data)) {
      if (!EXECUTION_DATA_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
      if (key === 'phase' && executionContextFromEvent(event)) continue;
      if (
        (key.endsWith('Digest') && (typeof value !== 'string' || !DIGEST.test(value))) ||
        (key.endsWith('Id') &&
          (typeof value !== 'string' || (!safeExecutionId(value) && !DIGEST.test(value))))
      ) {
        continue;
      }
      let normalized = value;
      if (key === 'workKind' && typeof value === 'string' && !BOUNDED_WORK_KINDS.has(value)) {
        normalized = 'custom';
      } else if (key === 'phase' && typeof value === 'string' && !BOUNDED_PHASES.has(value)) {
        normalized = 'unknown';
      } else if (key === 'result' && typeof value === 'string' && !BOUNDED_RESULTS.has(value)) {
        normalized = 'unknown';
      } else if (
        key === 'findingKind' &&
        typeof value === 'string' &&
        ![
          'implementation_failure',
          'design_assumption_invalid',
          'planning_semantics_changed',
          'evidence_unavailable',
          'external_result_unknown',
        ].includes(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'validatorFindingKind' &&
        typeof value === 'string' &&
        !['none', 'contract-rejected', 'validator-error', 'unknown'].includes(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'skillName' &&
        typeof value === 'string' &&
        ![
          'repoctopus-open-change',
          'repoctopus-design-change',
          'repoctopus-build-task',
          'repoctopus-verify-change',
          'repoctopus-archive-change',
          'grilling',
          'tdd',
          'codebase-design',
          'diagnosing-bugs',
          'code-review',
          'pr',
        ].includes(value)
      ) {
        normalized = 'custom';
      } else if (
        key === 'toolKind' &&
        (typeof value !== 'string' || !BOUNDED_TOOL_KINDS.has(value))
      ) {
        normalized = 'unknown';
      } else if (
        key === 'toolCategory' &&
        (typeof value !== 'string' || !BOUNDED_TOOL_CATEGORIES.has(value))
      ) {
        continue;
      } else if (
        key === 'observationStatus' &&
        (typeof value !== 'string' || !BOUNDED_OBSERVATION_STATUSES.has(value))
      ) {
        normalized = 'unknown';
      } else if (
        key === 'callCount' &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
      ) {
        continue;
      } else if (
        key === 'modelVersion' &&
        (typeof value !== 'string' || !MODEL_VERSION.test(value))
      ) {
        continue;
      }
      const safe = scalar(normalized);
      if (safe !== undefined) attributes[`repoctopus.execution.${key}`] = safe;
    }
  }
  const actionReceiptId = event.data.actionReceiptId;
  if (typeof actionReceiptId === 'string' && ACTION_RECEIPT_ID.test(actionReceiptId)) {
    attributes['repoctopus.action.receipt.id'] = actionReceiptId;
  }
  addEvidenceCorrelation(attributes, event);
  addTaskCorrelation(attributes, event);
  addDecisionCorrelation(attributes, event);
  addHostTelemetryAttributes(attributes, event);
  addTelemetryPipelineAttributes(attributes, event);
  return attributes;
}

const BOUNDED_PHASES = new Set(['open', 'design', 'build', 'verify', 'archive']);
const BOUNDED_WORK_KINDS = new Set([
  'change.intake',
  'specification.plan',
  'task.implement',
  'evidence.verify',
  'specification.close',
  'delivery.publish',
]);
const BOUNDED_RESULTS = new Set([
  'succeeded',
  'failed',
  'unknown',
  'accepted',
  'rejected',
  'implementation-failure',
  'evidence-unavailable',
  'started',
  'completed',
  'reopened',
  'not-executed',
]);

export function executionMetricAttributes(event: TrajectoryEvent): Attributes | null {
  if (!EXECUTION_EVENTS.has(event.type)) return null;
  const context = executionContextFromEvent(event);
  const recovery = event.data.recovery;
  const recoveryPhase =
    recovery && typeof recovery === 'object'
      ? (recovery as Record<string, unknown>).sourcePhase
      : undefined;
  const eventPhase = event.data.phase;
  const phase =
    context?.phase ??
    (recoveryPhase === 'verify' || recoveryPhase === 'archive'
      ? recoveryPhase
      : typeof eventPhase === 'string'
        ? eventPhase
        : 'unknown');
  const workKind = context?.work.kind ?? 'unknown';
  const result = typeof event.data.result === 'string' ? event.data.result : 'unknown';
  const continuation =
    typeof event.data.continuation === 'string' &&
    ['execute', 'ask', 'wait', 'reconcile', 'done'].includes(event.data.continuation)
      ? event.data.continuation
      : 'unknown';
  const attributes: Attributes = {
    'repoctopus.execution.event.type': event.type,
    'repoctopus.execution.phase': BOUNDED_PHASES.has(phase) ? phase : 'unknown',
    'repoctopus.execution.work.kind': BOUNDED_WORK_KINDS.has(workKind) ? workKind : 'custom',
    'repoctopus.execution.result': BOUNDED_RESULTS.has(result) ? result : 'unknown',
    'repoctopus.execution.continuation': continuation,
  };
  const toolKind = event.data.toolKind;
  if (typeof toolKind === 'string' && BOUNDED_TOOL_KINDS.has(toolKind)) {
    attributes['repoctopus.tool.kind'] = toolKind;
  }
  const toolCategory = event.data.toolCategory;
  if (typeof toolCategory === 'string' && BOUNDED_TOOL_CATEGORIES.has(toolCategory)) {
    attributes['repoctopus.tool.category'] = toolCategory;
  }
  const decisionKind = event.data.decisionKind;
  if (typeof decisionKind === 'string' && BOUNDED_DECISION_KINDS.has(decisionKind)) {
    attributes['repoctopus.decision.kind'] = decisionKind;
  }
  const waitKind = event.data.waitKind;
  if (typeof waitKind === 'string' && BOUNDED_WAIT_KINDS.has(waitKind)) {
    attributes['repoctopus.wait.kind'] = waitKind;
  }
  return attributes;
}

export function eventSeverity(type: TrajectoryEvent['type']): number {
  return type === 'recovery.reconciled' ||
    type === 'task.failed' ||
    type === 'telemetry.gap-recorded'
    ? 13
    : 9;
}

export function workflowEventMetricAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Attributes {
  return {
    'repoctopus.event.type': event.type,
    'repoctopus.workflow.name': batch.run.workflowName,
  };
}

export function workflowStepMetricAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Attributes {
  const result = event.data.result;
  return {
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.event.result': result === 'succeeded' || result === 'failed' ? result : 'unknown',
  };
}
