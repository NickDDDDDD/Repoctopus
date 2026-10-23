import { createHash } from 'node:crypto';

import { canonicalJson, canonicalValue } from '../workflow-contract/canonical.js';

export type ObservationAttributeValue = string | number | boolean;

export interface ObservationSource {
  domain: string;
  eventId: string;
  eventType: string;
  sequence?: number;
}

export type ObservationSignal =
  | {
      kind: 'trace';
      name: string;
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
      startedAt?: string;
      endedAt?: string;
      status?: 'ok' | 'error';
    }
  | {
      kind: 'log';
      name: string;
      severity: 'debug' | 'info' | 'warn' | 'error';
      traceId?: string;
      spanId?: string;
    }
  | {
      kind: 'metric';
      name: string;
      value: number;
      unit: string;
      aggregation?: 'counter' | 'histogram';
      attributes?: Record<string, ObservationAttributeValue>;
    };

export interface ObservationEnvelope {
  schemaVersion: 1;
  envelopeId: string;
  digest: string;
  source: ObservationSource;
  observedAt: string;
  attributes: Record<string, ObservationAttributeValue>;
  signals: ObservationSignal[];
}

export interface ObservationFact {
  source: ObservationSource;
  observedAt: string;
  attributes: Readonly<Record<string, unknown>>;
}

export interface ObservationMapping {
  allowedAttributes: readonly string[];
  signals: readonly ObservationSignal[];
}

const SAFE_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const SAFE_ATTRIBUTE_NAME = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$/u;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_ATTRIBUTE_KEY =
  /(?:^|[._-])(authorization|body|command|cookie|credential|environment|output|password|path|prompt|reply|secret|token)(?:$|[._-])/iu;
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|api[-_]?key|password|secret|token|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function assertName(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_NAME.test(value) || value.length > 128) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertAttributeName(value: string): void {
  if (!SAFE_ATTRIBUTE_NAME.test(value) || value.length > 128) {
    throw new Error('Invalid observation attribute name');
  }
}

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || SENSITIVE_VALUE.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function safeAttributeValue(value: unknown): ObservationAttributeValue | undefined {
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

function normalizeAttributes(
  attributes: Readonly<Record<string, unknown>>,
  allowedAttributes: readonly string[],
): Record<string, ObservationAttributeValue> {
  const normalized: Record<string, ObservationAttributeValue> = {};
  for (const key of [...new Set(allowedAttributes)].sort()) {
    assertAttributeName(key);
    if (FORBIDDEN_ATTRIBUTE_KEY.test(key)) {
      throw new Error(`Unsafe observation attribute allowlist entry: ${key}`);
    }
    const value = safeAttributeValue(attributes[key]);
    if (value !== undefined) normalized[key] = value;
  }
  return normalized;
}

function normalizeSignals(signals: readonly ObservationSignal[]): ObservationSignal[] {
  return signals.map((signal) => {
    if (!signal || typeof signal !== 'object') throw new Error('Invalid observation signal');
    assertName(signal.name, 'observation signal name');
    if (signal.kind === 'trace') {
      for (const [value, label, pattern] of [
        [signal.traceId, 'trace id', /^[a-f0-9]{32}$/u],
        [signal.spanId, 'span id', /^[a-f0-9]{16}$/u],
        [signal.parentSpanId, 'parent span id', /^[a-f0-9]{16}$/u],
      ] as const) {
        if (value !== undefined && !pattern.test(value)) throw new Error(`Invalid ${label}`);
      }
      for (const timestamp of [signal.startedAt, signal.endedAt]) {
        if (timestamp !== undefined && Number.isNaN(Date.parse(timestamp))) {
          throw new Error('Invalid observation signal timestamp');
        }
      }
      if (signal.status !== undefined && !['ok', 'error'].includes(signal.status)) {
        throw new Error('Invalid observation trace status');
      }
      return {
        kind: signal.kind,
        name: signal.name,
        ...(signal.traceId === undefined ? {} : { traceId: signal.traceId }),
        ...(signal.spanId === undefined ? {} : { spanId: signal.spanId }),
        ...(signal.parentSpanId === undefined ? {} : { parentSpanId: signal.parentSpanId }),
        ...(signal.startedAt === undefined
          ? {}
          : { startedAt: new Date(signal.startedAt).toISOString() }),
        ...(signal.endedAt === undefined
          ? {}
          : { endedAt: new Date(signal.endedAt).toISOString() }),
        ...(signal.status === undefined ? {} : { status: signal.status }),
      };
    }
    if (signal.kind === 'log') {
      if (!['debug', 'info', 'warn', 'error'].includes(signal.severity)) {
        throw new Error('Invalid observation log severity');
      }
      if (signal.traceId !== undefined && !/^[a-f0-9]{32}$/u.test(signal.traceId)) {
        throw new Error('Invalid trace id');
      }
      if (signal.spanId !== undefined && !/^[a-f0-9]{16}$/u.test(signal.spanId)) {
        throw new Error('Invalid span id');
      }
      return {
        kind: signal.kind,
        name: signal.name,
        severity: signal.severity,
        ...(signal.traceId === undefined ? {} : { traceId: signal.traceId }),
        ...(signal.spanId === undefined ? {} : { spanId: signal.spanId }),
      };
    }
    if (signal.kind === 'metric') {
      if (!Number.isFinite(signal.value)) throw new Error('Metric value must be finite');
      assertName(signal.unit, 'metric unit');
      if (
        signal.aggregation !== undefined &&
        !['counter', 'histogram'].includes(signal.aggregation)
      ) {
        throw new Error('Invalid observation metric aggregation');
      }
      return {
        kind: signal.kind,
        name: signal.name,
        value: signal.value,
        unit: signal.unit,
        ...(signal.aggregation === undefined ? {} : { aggregation: signal.aggregation }),
        ...(signal.attributes === undefined
          ? {}
          : {
              attributes: normalizeAttributes(signal.attributes, Object.keys(signal.attributes)),
            }),
      };
    }
    throw new Error('Invalid observation signal kind');
  });
}

function stableEnvelope(envelope: ObservationEnvelope): Omit<ObservationEnvelope, 'digest'> {
  return {
    schemaVersion: envelope.schemaVersion,
    envelopeId: envelope.envelopeId,
    source: envelope.source,
    observedAt: envelope.observedAt,
    attributes: envelope.attributes,
    signals: envelope.signals,
  };
}

export function mapObservationEnvelope(
  fact: ObservationFact,
  mapping: ObservationMapping,
): ObservationEnvelope {
  assertName(fact.source.domain, 'observation source domain');
  assertName(fact.source.eventType, 'observation event type');
  assertId(fact.source.eventId, 'observation event id');
  if (
    fact.source.sequence !== undefined &&
    (!Number.isSafeInteger(fact.source.sequence) || fact.source.sequence < 0)
  ) {
    throw new Error('Observation sequence must be a non-negative safe integer');
  }
  if (Number.isNaN(Date.parse(fact.observedAt))) throw new Error('Invalid observation timestamp');

  const source = canonicalValue({
    domain: fact.source.domain,
    eventId: fact.source.eventId,
    eventType: fact.source.eventType,
    ...(fact.source.sequence === undefined ? {} : { sequence: fact.source.sequence }),
  }) as ObservationSource;
  const envelopeId = sha256({ schemaVersion: 1, source });
  const unsigned: Omit<ObservationEnvelope, 'digest'> = {
    schemaVersion: 1,
    envelopeId,
    source,
    observedAt: new Date(fact.observedAt).toISOString(),
    attributes: normalizeAttributes(fact.attributes, mapping.allowedAttributes),
    signals: normalizeSignals(mapping.signals),
  };
  return { ...unsigned, digest: sha256(unsigned) };
}

export function validateObservationEnvelope(value: unknown): asserts value is ObservationEnvelope {
  if (!value || typeof value !== 'object') throw new Error('Invalid observation envelope');
  const envelope = value as ObservationEnvelope;
  if (
    envelope.schemaVersion !== 1 ||
    !DIGEST.test(envelope.envelopeId) ||
    !DIGEST.test(envelope.digest) ||
    !envelope.source ||
    typeof envelope.source !== 'object' ||
    !Array.isArray(envelope.signals) ||
    !envelope.attributes ||
    typeof envelope.attributes !== 'object' ||
    Array.isArray(envelope.attributes)
  ) {
    throw new Error('Invalid observation envelope');
  }

  const remapped = mapObservationEnvelope(
    {
      source: envelope.source,
      observedAt: envelope.observedAt,
      attributes: envelope.attributes,
    },
    {
      allowedAttributes: Object.keys(envelope.attributes),
      signals: envelope.signals,
    },
  );
  if (
    remapped.envelopeId !== envelope.envelopeId ||
    sha256(stableEnvelope(envelope)) !== envelope.digest ||
    canonicalJson(remapped) !== canonicalJson(envelope)
  ) {
    throw new Error(`Observation envelope integrity check failed: ${envelope.envelopeId}`);
  }
}
