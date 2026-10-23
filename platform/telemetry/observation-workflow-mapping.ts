import { createHash } from 'node:crypto';

import type { TelemetryBatch } from '../../domains/runtime/types.js';
import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import { mapObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';

const SAFE_DATA_KEYS = new Set([
  'actionId',
  'result',
  'recoveredTransition',
  'repositoryCount',
  'workflowName',
  'workflowVersion',
]);
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ACTION_RECEIPT_ID = /^[a-f0-9]{64}$/u;
const SAFE_DOMAIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

const POST_MERGE_RECEIPT_KINDS = new Map([
  ['post-merge.checkout-exact-commits', 'checkout-manifest'],
  ['post-merge.close-specification', 'specification-closure'],
  ['post-merge.audit-paths', 'path-audit'],
  ['post-merge.publish-change', 'publication'],
]);

function scalar(value: unknown): ObservationAttributeValue | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (
    typeof value === 'string' &&
    value.length <= 256 &&
    !value.includes('\n') &&
    !value.includes('\r') &&
    !ABSOLUTE_PATH.test(value) &&
    !SENSITIVE_VALUE.test(value)
  ) {
    return value;
  }
  return undefined;
}

function proposedAction(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): { event: TrajectoryEvent; action: Record<string, unknown> } | undefined {
  if (event.type !== 'action.completed' || typeof event.data.actionId !== 'string') {
    return undefined;
  }
  const proposed = batch.trajectory.find((candidate) => {
    if (candidate.type !== 'action.proposed') return false;
    const action = candidate.data.action;
    return (
      action !== null &&
      typeof action === 'object' &&
      (action as Record<string, unknown>).id === event.data.actionId
    );
  });
  const action = proposed?.data.action;
  return proposed && action && typeof action === 'object'
    ? { event: proposed, action: action as Record<string, unknown> }
    : undefined;
}

function eventAction(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Record<string, unknown> | undefined {
  const action = event.data.action;
  if (action && typeof action === 'object') return action as Record<string, unknown>;
  return proposedAction(batch, event)?.action;
}

function eventStage(batch: TelemetryBatch, event: TrajectoryEvent): string | undefined {
  if (event.type === 'run.started') return batch.workflow.definition.entry;
  const stepId = eventAction(batch, event)?.stepId;
  return typeof stepId === 'string' ? stepId : undefined;
}

function addEvidenceCorrelation(
  attributes: Record<string, ObservationAttributeValue>,
  event: TrajectoryEvent,
): void {
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

function addPostMergeCorrelation(
  attributes: Record<string, ObservationAttributeValue>,
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): void {
  const trigger = batch.run.trigger;
  if (trigger?.kind !== 'post-merge' || !SHA256_DIGEST.test(trigger.identityDigest)) return;
  attributes['repoctopus.post_merge.merge_facts.digest'] = trigger.identityDigest;
  if (
    typeof trigger.facts.changeId === 'string' &&
    SAFE_DOMAIN_ID.test(trigger.facts.changeId) &&
    !SENSITIVE_VALUE.test(trigger.facts.changeId)
  ) {
    attributes['repoctopus.post_merge.change.id'] = trigger.facts.changeId;
  }

  const actionRef = eventAction(batch, event)?.ref;
  const receiptKind =
    typeof actionRef === 'string' ? POST_MERGE_RECEIPT_KINDS.get(actionRef) : undefined;
  const receiptId = event.data.correlationReceiptId;
  if (receiptKind && typeof receiptId === 'string' && SHA256_DIGEST.test(receiptId)) {
    attributes['repoctopus.post_merge.receipt.kind'] = receiptKind;
    attributes['repoctopus.post_merge.receipt.id'] = receiptId;
  }
}

/** Stable allowlisted attributes derived only from the event and immutable Run identity. */
export function workflowObservationAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Record<string, ObservationAttributeValue> {
  const attributes: Record<string, ObservationAttributeValue> = {
    'repoctopus.project.id': batch.projectSnapshot.projectId,
    'repoctopus.workspace.id': batch.projectSnapshot.projectId,
    'repoctopus.run.id': batch.run.runId,
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.workflow.version': batch.run.workflowVersion,
    'repoctopus.workflow.digest': batch.run.workflowDigest,
    'repoctopus.composition.digest': event.compositionDigest,
    'repoctopus.event.id': event.eventId,
    'repoctopus.event.sequence': event.sequence,
    'repoctopus.state.version': event.stateVersion,
    'repoctopus.repository.count': batch.projectSnapshot.repositories.length,
  };
  if (batch.run.changeId) attributes['repoctopus.change.id'] = batch.run.changeId;
  if (event.type === 'run.started') {
    if (batch.run.changeId) attributes['repoctopus.change.status'] = 'active';
    attributes['repoctopus.run.status'] = 'active';
  }
  const stageName = eventStage(batch, event);
  if (stageName) attributes['repoctopus.stage.name'] = stageName;

  const action = eventAction(batch, event);
  const actionType = scalar(action?.type);
  const actionRef = scalar(action?.ref);
  if (actionType !== undefined) attributes['repoctopus.action.type'] = actionType;
  if (actionRef !== undefined) attributes['repoctopus.action.ref'] = actionRef;
  for (const [key, value] of Object.entries(event.data)) {
    if (!SAFE_DATA_KEYS.has(key)) continue;
    const safe = scalar(value);
    if (safe !== undefined) attributes[`repoctopus.event.${key}`] = safe;
  }
  if (
    typeof event.data.actionReceiptId === 'string' &&
    ACTION_RECEIPT_ID.test(event.data.actionReceiptId)
  ) {
    attributes['repoctopus.action.receipt.id'] = event.data.actionReceiptId;
  }
  if (event.type === 'action.completed' && typeof event.data.actionId === 'string') {
    const proposed = proposedAction(batch, event)?.event;
    const startedAt = proposed?.timestamp ?? event.timestamp;
    attributes['repoctopus.action.duration_ms'] = Math.max(
      0,
      Date.parse(event.timestamp) - Date.parse(startedAt),
    );
    attributes['repoctopus.action.retry_count'] = batch.trajectory.filter(
      (candidate) =>
        candidate.sequence <= event.sequence &&
        candidate.type === 'action.completed' &&
        candidate.data.actionId === event.data.actionId &&
        candidate.data.result === 'failed',
    ).length;
  }
  addEvidenceCorrelation(attributes, event);
  addPostMergeCorrelation(attributes, batch, event);
  return attributes;
}

export function workflowMetricAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): {
  event: Record<string, ObservationAttributeValue>;
  step: Record<string, ObservationAttributeValue>;
} {
  const result = event.data.result;
  return {
    event: {
      'repoctopus.event.type': event.type,
      'repoctopus.workflow.name': batch.run.workflowName,
    },
    step: {
      'repoctopus.workflow.name': batch.run.workflowName,
      'repoctopus.event.result': result === 'succeeded' || result === 'failed' ? result : 'unknown',
    },
  };
}

function rootSpanId(runId: string): string {
  return createHash('sha256').update(runId).digest('hex').slice(0, 16);
}

function eventSpanId(eventId: string): string {
  return createHash('sha256').update(eventId).digest('hex').slice(0, 16);
}

function workflowSignals(batch: TelemetryBatch, event: TrajectoryEvent): ObservationSignal[] {
  const rootId = rootSpanId(batch.run.runId);
  const metrics = workflowMetricAttributes(batch, event);
  const signals: ObservationSignal[] = [
    {
      kind: 'log',
      name: `repoctopus.${event.type}`,
      severity: event.type === 'recovery.reconciled' ? 'warn' : 'info',
      traceId: batch.run.traceId,
      spanId: rootId,
    },
    {
      kind: 'metric',
      name: 'repoctopus.workflow.events',
      value: 1,
      unit: 'event',
      aggregation: 'counter',
      attributes: metrics.event,
    },
  ];
  if (event.type === 'run.started') {
    signals.unshift({
      kind: 'trace',
      name: 'repoctopus.run',
      traceId: batch.run.traceId,
      spanId: rootId,
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      status: 'ok',
    });
  }
  if (event.type === 'action.completed') {
    const proposed = proposedAction(batch, event)?.event;
    const startedAt = proposed?.timestamp ?? event.timestamp;
    const duration = Math.max(0, Date.parse(event.timestamp) - Date.parse(startedAt));
    signals.unshift(
      {
        kind: 'trace',
        name: 'repoctopus.step',
        traceId: batch.run.traceId,
        spanId: eventSpanId(event.eventId),
        parentSpanId: rootId,
        startedAt,
        endedAt: event.timestamp,
        status: event.data.result === 'failed' ? 'error' : 'ok',
      },
      {
        kind: 'metric',
        name: 'repoctopus.workflow.step.duration',
        value: duration,
        unit: 'ms',
        aggregation: 'histogram',
        attributes: metrics.step,
      },
    );
  }
  return signals;
}

export function mapWorkflowObservationEnvelope(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): ObservationEnvelope {
  const attributes = workflowObservationAttributes(batch, event);
  return mapObservationEnvelope(
    {
      source: {
        domain: 'workflow',
        eventId: event.eventId,
        eventType: event.type,
        sequence: event.sequence,
      },
      observedAt: event.timestamp,
      attributes,
    },
    { allowedAttributes: Object.keys(attributes), signals: workflowSignals(batch, event) },
  );
}
