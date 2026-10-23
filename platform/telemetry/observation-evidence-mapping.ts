import { createHash } from 'node:crypto';

import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryEvent,
} from '../../domains/evidence/telemetry.js';
import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import { mapObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';

const ALLOWED_DATA = new Set([
  'adapter',
  'artifactDigest',
  'artifactSize',
  'artifactType',
  'bundleId',
  'durationMs',
  'freshness',
  'gateStatus',
  'inputFingerprint',
  'mediaType',
  'nodeId',
  'outcome',
  'profileId',
  'receiptId',
  'redacted',
  'sourceReceiptId',
  'status',
  'trust',
]);
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|api[-_]?key|password|secret|token|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;

function scalar(value: unknown): ObservationAttributeValue | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (
    typeof value === 'string' &&
    value.length <= 256 &&
    !value.includes('\n') &&
    !value.includes('\r') &&
    !SENSITIVE_VALUE.test(value) &&
    !ABSOLUTE_PATH.test(value)
  ) {
    return value;
  }
  return undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) && !SENSITIVE_VALUE.test(value)
    ? value
    : undefined;
}

function addTrustedStateAttributes(
  attributes: Record<string, ObservationAttributeValue>,
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): void {
  const runId = safeId(batch.runId);
  const attemptId = safeId(batch.attemptId);
  if (attemptId) {
    attributes['repoctopus.verification.id'] = attemptId;
    attributes['repoctopus.execution.id'] = attemptId;
    attributes['repoctopus.execution.kind'] = 'evidence-attempt';
    if (runId) attributes['repoctopus.execution.parent.id'] = runId;
  }
  if (event.type === 'evidence.attempt.started') {
    attributes['repoctopus.verification.status'] = 'running';
    return;
  }
  if (event.type === 'evidence.attempt.completed') {
    const status = scalar(event.data.status);
    if (status !== undefined) attributes['repoctopus.verification.status'] = status;
    return;
  }
  if (event.type === 'evidence.gate.evaluated') {
    const gateStatus = event.data.gateStatus;
    const outcome = event.data.outcome;
    if (gateStatus === 'satisfied' || gateStatus === 'blocked') {
      attributes['repoctopus.verification.status'] = gateStatus;
    }
    if (
      outcome === 'passed' ||
      outcome === 'failed' ||
      outcome === 'incomplete' ||
      outcome === 'passed_with_warnings'
    ) {
      attributes['repoctopus.verification.outcome'] = outcome;
    }
    if (gateStatus === 'blocked') {
      attributes['repoctopus.blocker.category'] = 'evidence-gate';
      const bundleId = safeId(event.data.bundleId);
      if (bundleId) attributes['repoctopus.blocker.request.id'] = bundleId;
    }
    return;
  }
  if (event.type !== 'evidence.node.completed') return;
  const receiptId = safeId(event.data.receiptId);
  const nodeId = safeId(event.data.nodeId);
  const adapter = safeId(event.data.adapter);
  if (receiptId) {
    attributes['repoctopus.execution.id'] = receiptId;
    if (attemptId) attributes['repoctopus.execution.parent.id'] = attemptId;
    attributes['repoctopus.execution.kind'] = 'evidence-node';
    attributes['repoctopus.task.id'] = receiptId;
  }
  if (nodeId) attributes['repoctopus.task.ref'] = nodeId;
  const status = event.data.status;
  if (status === 'passed') attributes['repoctopus.task.status'] = 'completed';
  if (status === 'failed' || status === 'incomplete')
    attributes['repoctopus.task.status'] = 'failed';
  if (adapter) {
    attributes['repoctopus.execution.subject.kind'] = 'evidence-adapter';
    attributes['repoctopus.execution.subject.id'] = adapter;
  }
}

/** Stable allowlisted attributes derived only from a durable Evidence event. */
export function evidenceObservationAttributes(
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): Record<string, ObservationAttributeValue> {
  const attributes: Record<string, ObservationAttributeValue> = {
    'repoctopus.evidence.event.id': event.eventId,
    'repoctopus.evidence.event.type': event.type,
    'repoctopus.evidence.event.sequence': event.sequence,
    'repoctopus.evidence.attempt.id': batch.attemptId,
    'repoctopus.evidence.profile.id': batch.profileId,
    'repoctopus.composition.digest': batch.compositionDigest,
  };
  if (batch.runId) attributes['repoctopus.run.id'] = batch.runId;
  for (const [key, value] of Object.entries(event.data)) {
    if (!ALLOWED_DATA.has(key)) continue;
    const safe = scalar(value);
    if (safe !== undefined) attributes[`repoctopus.evidence.${key}`] = safe;
  }
  addTrustedStateAttributes(attributes, batch, event);
  return attributes;
}

function hashId(value: string, length: 16 | 32): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function evidenceSignals(
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): ObservationSignal[] {
  const traceId = hashId(batch.runId ?? batch.attemptId, 32);
  const attemptSpanId = hashId(batch.attemptId, 16);
  const eventSpanId = hashId(event.eventId, 16);
  const signals: ObservationSignal[] = [
    {
      kind: 'log',
      name: `repoctopus.${event.type}`,
      severity:
        event.data.status === 'failed' ||
        event.data.status === 'incomplete' ||
        event.data.status === 'superseded' ||
        event.data.gateStatus === 'blocked'
          ? 'warn'
          : 'info',
      traceId,
      spanId:
        event.type === 'evidence.node.completed' || event.type === 'evidence.artifact.recorded'
          ? eventSpanId
          : attemptSpanId,
    },
    {
      kind: 'metric',
      name: 'repoctopus.evidence.events',
      value: 1,
      unit: 'event',
      aggregation: 'counter',
      attributes: { 'repoctopus.evidence.event.type': event.type },
    },
  ];
  if (event.type === 'evidence.attempt.started') {
    signals.unshift({
      kind: 'trace',
      name: 'repoctopus.evidence.attempt',
      traceId,
      spanId: attemptSpanId,
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      status: 'ok',
    });
  }
  if (event.type === 'evidence.node.completed') {
    const durationMs =
      typeof event.data.durationMs === 'number' && Number.isFinite(event.data.durationMs)
        ? Math.max(0, event.data.durationMs)
        : 0;
    signals.unshift(
      {
        kind: 'trace',
        name: 'repoctopus.evidence.node',
        traceId,
        spanId: eventSpanId,
        parentSpanId: attemptSpanId,
        startedAt: new Date(Date.parse(event.timestamp) - durationMs).toISOString(),
        endedAt: event.timestamp,
        status:
          event.data.status === 'failed' || event.data.status === 'incomplete' ? 'error' : 'ok',
      },
      {
        kind: 'metric',
        name: 'repoctopus.evidence.node.duration',
        value: durationMs,
        unit: 'ms',
        aggregation: 'histogram',
        attributes: {
          'repoctopus.evidence.adapter': String(event.data.adapter ?? 'unknown'),
          'repoctopus.evidence.status': String(event.data.status ?? 'unknown'),
          'repoctopus.evidence.freshness': String(event.data.freshness ?? 'unknown'),
        },
      },
    );
  }
  return signals;
}

export function mapEvidenceObservationEnvelope(
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): ObservationEnvelope {
  const attributes = evidenceObservationAttributes(batch, event);
  return mapObservationEnvelope(
    {
      source: {
        domain: 'evidence',
        eventId: event.eventId,
        eventType: event.type,
        sequence: event.sequence,
      },
      observedAt: event.timestamp,
      attributes,
    },
    { allowedAttributes: Object.keys(attributes), signals: evidenceSignals(batch, event) },
  );
}
