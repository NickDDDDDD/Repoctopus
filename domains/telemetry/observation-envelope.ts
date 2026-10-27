import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  observationEventSchema,
  validateObservationAttributes,
  validateObservationMetricAttributes,
} from './observation-contract.js';

export type ObservationAttributeValue = string | number | boolean;
export type ObservationDigest = `sha256:${string}`;

export interface ObservationEnvelopeInput {
  source: {
    eventId: string;
    eventName: string;
    observedAt: string;
  };
  correlation: {
    traceId: string;
    spanId: string;
    operationId?: string;
  };
  resourceAttributes: Record<string, unknown>;
  recordAttributes: Record<string, unknown>;
  metric?: {
    value: number;
    attributes: Record<string, unknown>;
  };
}

interface ObservationRecordBase {
  schemaVersion: 1;
  name: string;
  observedAt: string;
  attributes: Readonly<Record<string, ObservationAttributeValue>>;
}

export interface ObservationLogRecord extends ObservationRecordBase {
  signal: 'log';
  traceId: string;
  spanId: string;
}

export interface ObservationSpanRecord extends ObservationRecordBase {
  signal: 'span';
  traceId: string;
  spanId: string;
  strategy: 'point' | 'boundary-start' | 'boundary-end';
  operation?: string;
  operationId?: string;
}

export interface ObservationMetricRecord extends ObservationRecordBase {
  signal: 'metric';
  instrument: 'counter' | 'histogram' | 'gauge';
  value: number;
}

export type ObservationEnvelopeRecord =
  | ObservationLogRecord
  | ObservationSpanRecord
  | ObservationMetricRecord;

export interface ObservationEnvelope {
  schemaVersion: 1;
  envelopeId: ObservationDigest;
  source: {
    schemaVersion: 1;
    eventId: string;
    eventName: string;
    observedAt: string;
  };
  resource: {
    schemaVersion: 1;
    attributes: Readonly<Record<string, ObservationAttributeValue>>;
  };
  scope: {
    schemaVersion: 1;
    name: 'io.repoctopus.observation';
    version: '1.0.0';
  };
  records: readonly ObservationEnvelopeRecord[];
  canonicalDigest: ObservationDigest;
}

const TRACE_ID = /^[a-f0-9]{32}$/u;
const SPAN_ID = /^[a-f0-9]{16}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PRIVATE_CONTENT_KEY =
  /(?:^|[._-])(content|log|message|screenshot|summary|text)$/iu;

function digest(value: unknown): ObservationDigest {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function stableIdentity(value: string, label: string): string {
  if (!STABLE_ID.test(value)) throw new Error(`${label} must be a stable bounded identity`);
  return value;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Observation timestamp is invalid');
  return parsed.toISOString();
}

function attributes(
  candidate: Readonly<Record<string, unknown>>,
): Record<string, ObservationAttributeValue> {
  for (const key of Object.keys(candidate)) {
    if (PRIVATE_CONTENT_KEY.test(key)) throw new Error(`Unsafe observation attribute: ${key}`);
  }
  return validateObservationAttributes(candidate);
}

function finiteMetricValue(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Observation Metric value must be a finite non-negative number');
  }
  return value;
}

function envelopeIdentity(source: {
  eventId: string;
  eventName: string;
}): ObservationDigest {
  return digest({
    schemaVersion: 1,
    namespace: 'repoctopus.observation-envelope',
    eventId: source.eventId,
    eventName: source.eventName,
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createObservationEnvelope(input: ObservationEnvelopeInput): ObservationEnvelope {
  const schema = observationEventSchema(input.source.eventName);
  const source = {
    schemaVersion: 1 as const,
    eventId: stableIdentity(input.source.eventId, 'Source event id'),
    eventName: schema.name,
    observedAt: timestamp(input.source.observedAt),
  };
  if (!TRACE_ID.test(input.correlation.traceId)) {
    throw new Error('Observation trace id must be 32 lowercase hexadecimal characters');
  }
  if (!SPAN_ID.test(input.correlation.spanId)) {
    throw new Error('Observation span id must be 16 lowercase hexadecimal characters');
  }

  const resourceAttributes = attributes(input.resourceAttributes);
  const recordAttributes = attributes(input.recordAttributes);
  const records: ObservationEnvelopeRecord[] = [];

  if (schema.log.emit) {
    records.push({
      schemaVersion: 1,
      signal: 'log',
      name: schema.name,
      observedAt: source.observedAt,
      traceId: input.correlation.traceId,
      spanId: input.correlation.spanId,
      attributes: recordAttributes,
    });
  }

  if (schema.span.strategy !== 'none') {
    const span: ObservationSpanRecord = {
      schemaVersion: 1,
      signal: 'span',
      name: schema.name,
      observedAt: source.observedAt,
      traceId: input.correlation.traceId,
      spanId: input.correlation.spanId,
      strategy: schema.span.strategy,
      attributes: recordAttributes,
    };
    if (schema.span.strategy === 'boundary-start' || schema.span.strategy === 'boundary-end') {
      if (!input.correlation.operationId) {
        throw new Error(`Observation ${schema.name} requires a stable operation identity`);
      }
      span.operation = schema.span.operation;
      span.operationId = stableIdentity(input.correlation.operationId, 'Operation id');
    }
    records.push(span);
  }

  if (schema.metric.instrument !== 'none') {
    if (!input.metric) throw new Error(`Observation ${schema.name} requires a Metric record`);
    records.push({
      schemaVersion: 1,
      signal: 'metric',
      name: schema.name,
      observedAt: source.observedAt,
      instrument: schema.metric.instrument,
      value: finiteMetricValue(input.metric.value),
      attributes: validateObservationMetricAttributes(schema.name, input.metric.attributes),
    });
  } else if (input.metric) {
    throw new Error(`Observation ${schema.name} does not allow a Metric record`);
  }

  const unsigned = {
    schemaVersion: 1 as const,
    envelopeId: envelopeIdentity(source),
    source,
    resource: {
      schemaVersion: 1 as const,
      attributes: resourceAttributes,
    },
    scope: {
      schemaVersion: 1 as const,
      name: 'io.repoctopus.observation' as const,
      version: '1.0.0' as const,
    },
    records,
  };
  return deepFreeze({ ...unsigned, canonicalDigest: digest(unsigned) });
}

export function assertObservationEnvelopeIntegrity(
  envelope: ObservationEnvelope,
): asserts envelope is ObservationEnvelope {
  if (
    envelope.schemaVersion !== 1 ||
    !DIGEST.test(envelope.envelopeId) ||
    !DIGEST.test(envelope.canonicalDigest)
  ) {
    throw new Error('Observation envelope identity or schema is invalid');
  }
  if (envelope.envelopeId !== envelopeIdentity(envelope.source)) {
    throw new Error('Observation envelope identity does not match its source event');
  }
  const { canonicalDigest, ...unsigned } = envelope;
  if (digest(unsigned) !== canonicalDigest) {
    throw new Error('Observation envelope canonical digest does not match its payload');
  }
}

export function serializeObservationEnvelope(envelope: ObservationEnvelope): string {
  assertObservationEnvelopeIntegrity(envelope);
  return canonicalJson(envelope);
}
