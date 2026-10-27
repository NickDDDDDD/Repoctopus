import type { Attributes } from '@opentelemetry/api';

import type { TelemetryBatch } from '../../../domains/runtime/types.js';
import type { ExecutionContext } from '../../../domains/telemetry/execution-context.js';
import type { TrajectoryEvent } from '../../../domains/trajectory/types.js';

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
  'waitId',
  'reconcileId',
  'durationMs',
  'recovery',
  'findingCount',
  'findingKind',
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
  'skill.resolved',
  'skill.delivered',
  'skill.consumed',
  'tool.started',
  'tool.completed',
  'validator.completed',
  'wait.started',
  'wait.ended',
  'reconcile.started',
  'reconcile.completed',
  'continuation.selected',
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
    if (context.task.revision) {
      attributes['repoctopus.execution.task.revision'] = context.task.revision;
    }
  }
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

export function safeEventAttributes(batch: TelemetryBatch, event: TrajectoryEvent): Attributes {
  const attributes: Attributes = {
    'repoctopus.project.id': batch.projectSnapshot.projectId,
    'repoctopus.run.id': batch.run.runId,
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.workflow.version': batch.run.workflowVersion,
    'repoctopus.workflow.digest': batch.run.workflowDigest,
    'repoctopus.composition.digest': batch.run.composition.compositionDigest,
    'repoctopus.event.id': event.eventId,
    'repoctopus.event.sequence': event.sequence,
    'repoctopus.state.version': event.stateVersion,
    'repoctopus.repository.count': batch.projectSnapshot.repositories.length,
  };
  if (batch.run.currentStep) attributes['repoctopus.stage.name'] = batch.run.currentStep;

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
]);

export function executionMetricAttributes(event: TrajectoryEvent): Attributes | null {
  if (!EXECUTION_EVENTS.has(event.type)) return null;
  const context = executionContextFromEvent(event);
  const phase = context?.phase ?? 'unknown';
  const workKind = context?.work.kind ?? 'unknown';
  const result = typeof event.data.result === 'string' ? event.data.result : 'unknown';
  const continuation =
    typeof event.data.continuation === 'string' &&
    ['execute', 'ask', 'wait', 'reconcile', 'done'].includes(event.data.continuation)
      ? event.data.continuation
      : 'unknown';
  return {
    'repoctopus.execution.event.type': event.type,
    'repoctopus.execution.phase': BOUNDED_PHASES.has(phase) ? phase : 'unknown',
    'repoctopus.execution.work.kind': BOUNDED_WORK_KINDS.has(workKind) ? workKind : 'custom',
    'repoctopus.execution.result': BOUNDED_RESULTS.has(result) ? result : 'unknown',
    'repoctopus.execution.continuation': continuation,
  };
}

export function eventSeverity(type: TrajectoryEvent['type']): number {
  return type === 'recovery.reconciled' ? 13 : 9;
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
