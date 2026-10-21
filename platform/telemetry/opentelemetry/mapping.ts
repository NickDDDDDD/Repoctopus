import type { Attributes } from '@opentelemetry/api';

import type { TelemetryBatch } from '../../../domains/runtime/types.js';
import type { TrajectoryEvent } from '../../../domains/trajectory/types.js';

const SAFE_DATA_KEYS = new Set([
  'actionId',
  'result',
  'recoveredTransition',
  'repositoryCount',
  'workflowName',
  'workflowVersion',
]);

const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|secret|token|api[-_]?key|environment)/i;
const SENSITIVE_VALUE =
  /(bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ACTION_RECEIPT_ID = /^[a-f0-9]{64}$/u;
const SAFE_DOMAIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

const POST_MERGE_RECEIPT_KINDS = new Map([
  ['post-merge.checkout-exact-commits', 'checkout-manifest'],
  ['post-merge.close-specification', 'specification-closure'],
  ['post-merge.audit-paths', 'path-audit'],
  ['post-merge.publish-change', 'publication'],
]);

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    if (value.length > 256 || SENSITIVE_VALUE.test(value)) return undefined;
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function completedActionRef(batch: TelemetryBatch, event: TrajectoryEvent): string | undefined {
  if (event.type !== 'action.completed' || typeof event.data.actionId !== 'string') {
    return undefined;
  }
  const proposed = batch.trajectory.find((candidate) => {
    if (candidate.type !== 'action.proposed') return false;
    const action = candidate.data.action;
    return (
      !!action &&
      typeof action === 'object' &&
      (action as Record<string, unknown>).id === event.data.actionId
    );
  });
  const action = proposed?.data.action;
  if (!action || typeof action !== 'object') return undefined;
  const ref = (action as Record<string, unknown>).ref;
  return typeof ref === 'string' ? ref : undefined;
}

function addPostMergeCorrelation(
  attributes: Attributes,
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): void {
  const trigger = batch.run.trigger;
  if (trigger?.kind !== 'post-merge' || !SHA256_DIGEST.test(trigger.identityDigest)) return;
  attributes['repoctopus.post_merge.merge_facts.digest'] = trigger.identityDigest;
  const changeId = trigger.facts.changeId;
  if (
    typeof changeId === 'string' &&
    SAFE_DOMAIN_ID.test(changeId) &&
    !SENSITIVE_VALUE.test(changeId)
  ) {
    attributes['repoctopus.post_merge.change.id'] = changeId;
  }

  const actionRef = completedActionRef(batch, event);
  const receiptKind = actionRef ? POST_MERGE_RECEIPT_KINDS.get(actionRef) : undefined;
  const correlationReceiptId = event.data.correlationReceiptId;
  if (
    receiptKind &&
    typeof correlationReceiptId === 'string' &&
    SHA256_DIGEST.test(correlationReceiptId)
  ) {
    attributes['repoctopus.post_merge.receipt.kind'] = receiptKind;
    attributes['repoctopus.post_merge.receipt.id'] = correlationReceiptId;
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
  const actionReceiptId = event.data.actionReceiptId;
  if (typeof actionReceiptId === 'string' && ACTION_RECEIPT_ID.test(actionReceiptId)) {
    attributes['repoctopus.action.receipt.id'] = actionReceiptId;
  }
  addEvidenceCorrelation(attributes, event);
  addPostMergeCorrelation(attributes, batch, event);
  return attributes;
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
