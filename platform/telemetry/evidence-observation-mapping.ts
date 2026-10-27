import { createHash } from 'node:crypto';

import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryEvent,
} from '../../domains/evidence/telemetry.js';
import {
  createObservationEnvelope,
  type ObservationEnvelope,
  type ObservationEnvelopeInput,
} from '../../domains/telemetry/observation-envelope.js';
import { observationEventSchema } from '../../domains/telemetry/observation-contract.js';
import { safeEvidenceAttributes } from './evidence-mapping.js';

const RESTRICTED_KEY =
  /(authorization|body|command|content|cookie|credential|environment|output|password|path|prompt|reply|secret|token)/iu;
const SENSITIVE_VALUE =
  /(?:bearer\s+|gh[opusr]_[a-z0-9]{20,}|api[-_]?key|password|secret|token|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;

function assertPrivateContentAbsent(event: EvidenceTelemetryEvent): void {
  for (const [key, value] of Object.entries(event.data)) {
    if (
      RESTRICTED_KEY.test(key) ||
      (typeof value === 'string' &&
        (SENSITIVE_VALUE.test(value) ||
          ABSOLUTE_PATH.test(value) ||
          value.includes('\n') ||
          value.includes('\r')))
    ) {
      throw new Error(`Unsafe Evidence telemetry field: ${key}`);
    }
  }
}

function snakeCaseAttributeName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function recordAttributes(
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(safeEvidenceAttributes(batch, event)).map(([key, value]) => [
      snakeCaseAttributeName(key),
      value as string | number | boolean,
    ]),
  );
}

function traceId(batch: EvidenceTelemetryBatch): string {
  return createHash('sha256')
    .update(batch.runId ?? batch.attemptId)
    .digest('hex')
    .slice(0, 32);
}

function operationId(event: EvidenceTelemetryEvent): string {
  if (
    event.type === 'evidence.attempt.started' ||
    event.type === 'evidence.attempt.completed'
  ) {
    return event.attemptId;
  }
  if (event.type === 'evidence.node.completed' && typeof event.data.receiptId === 'string') {
    return event.data.receiptId;
  }
  return event.eventId;
}

function spanId(batch: EvidenceTelemetryBatch, event: EvidenceTelemetryEvent): string {
  return createHash('sha256')
    .update(`${batch.attemptId}\0${operationId(event)}`)
    .digest('hex')
    .slice(0, 16);
}

const METRIC_SOURCES: Readonly<Record<string, string>> = {
  'evidence.result': 'status',
  'evidence.freshness': 'freshness',
  'evidence.trust': 'trust',
  'evidence.gate': 'gateStatus',
};

function metricAttributes(event: EvidenceTelemetryEvent): Record<string, string | number | boolean> {
  const schema = observationEventSchema(event.type);
  const result: Record<string, string | number | boolean> = {};
  for (const [dimension, allowed] of Object.entries(schema.metric.dimensions)) {
    const source = METRIC_SOURCES[dimension];
    const raw =
      dimension === 'evidence.result' && event.type === 'evidence.gate.evaluated'
        ? event.data.outcome
        : source
          ? event.data[source]
          : undefined;
    if (
      (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') &&
      allowed.some((candidate) => candidate === raw)
    ) {
      result[dimension] = raw;
    }
  }
  return result;
}

function metricValue(event: EvidenceTelemetryEvent): number {
  if (
    (event.type === 'evidence.node.completed' ||
      event.type === 'evidence.attempt.completed') &&
    typeof event.data.durationMs === 'number'
  ) {
    return Math.max(0, event.data.durationMs);
  }
  return 1;
}

function mapEvent(
  batch: EvidenceTelemetryBatch,
  event: EvidenceTelemetryEvent,
): ObservationEnvelope {
  assertPrivateContentAbsent(event);
  const attributes = recordAttributes(batch, event);
  const input: ObservationEnvelopeInput = {
    source: {
      eventId: event.eventId,
      eventName: event.type,
      observedAt: event.timestamp,
    },
    correlation: {
      traceId: traceId(batch),
      spanId: spanId(batch, event),
      ...(['evidence.attempt.started', 'evidence.attempt.completed', 'evidence.node.completed'].includes(
        event.type,
      )
        ? { operationId: operationId(event) }
        : {}),
    },
    resourceAttributes: {
      'service.name': 'repoctopus-evidence',
      'service.version': '0.1.0',
      'repoctopus.composition.digest': batch.compositionDigest,
    },
    recordAttributes: attributes,
    metric: {
      value: metricValue(event),
      attributes: metricAttributes(event),
    },
  };
  return createObservationEnvelope(input);
}

/** Maps durable Evidence outbox events without reading Evidence Stores or destination state. */
export function mapEvidenceObservationEnvelopes(
  batch: EvidenceTelemetryBatch,
): readonly ObservationEnvelope[] {
  return batch.events.map((event) => mapEvent(batch, event));
}
