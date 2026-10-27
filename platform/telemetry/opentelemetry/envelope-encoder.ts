import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationMetricRecord,
  ObservationSpanRecord,
} from '../../../domains/telemetry/observation-envelope.js';

type EncodedAttributes = Readonly<Record<string, ObservationAttributeValue>>;

interface EncodedRecordBase {
  observedAt: string;
  resourceAttributes: EncodedAttributes;
  scope: ObservationEnvelope['scope'];
  attributes: EncodedAttributes;
}

export interface EncodedOtlpLog extends EncodedRecordBase {
  eventName: string;
  body: string;
  traceId: string;
  spanId: string;
}

export interface EncodedOtlpSpan extends EncodedRecordBase {
  name: string;
  traceId: string;
  spanId: string;
  startTime: string;
  endTime: string;
  result: string | null;
}

export interface EncodedOtlpMetric extends EncodedRecordBase {
  name: string;
  instrument: ObservationMetricRecord['instrument'];
  value: number;
}

export interface EncodedObservationSignals {
  logs: readonly EncodedOtlpLog[];
  spans: readonly EncodedOtlpSpan[];
  metrics: readonly EncodedOtlpMetric[];
}

const METRIC_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  phase: 'repoctopus.execution.phase',
  'work.kind': 'repoctopus.execution.work.kind',
  result: 'repoctopus.execution.result',
  continuation: 'repoctopus.execution.continuation',
  'task.result': 'repoctopus.task.result',
  'recovery.kind': 'repoctopus.recovery.kind',
  'skill.role': 'repoctopus.skill.role',
  'decision.kind': 'repoctopus.decision.kind',
  'wait.kind': 'repoctopus.wait.kind',
  'tool.kind': 'repoctopus.tool.kind',
  'tool.category': 'repoctopus.tool.category',
  'observation.status': 'repoctopus.tool.observation.status',
  'evidence.result': 'repoctopus.evidence.result',
  'destination.kind': 'repoctopus.telemetry.destination.kind',
};

function correlatedAttributes(
  envelope: ObservationEnvelope,
  attributes: EncodedAttributes,
): EncodedAttributes {
  return {
    ...attributes,
    'repoctopus.observation.envelope_id': envelope.envelopeId,
    'repoctopus.observation.canonical_digest': envelope.canonicalDigest,
  };
}

function metricAttributes(record: ObservationMetricRecord): EncodedAttributes {
  return {
    'repoctopus.execution.event.type': record.name,
    ...Object.fromEntries(
      Object.entries(record.attributes).map(([key, value]) => [
        METRIC_ATTRIBUTE_NAMES[key] ?? `repoctopus.observation.${key}`,
        value,
      ]),
    ),
  };
}

function spanName(record: ObservationSpanRecord): string {
  if (record.operation) return `repoctopus.${record.operation}`;
  return `repoctopus.${record.name.split('.', 1)[0] ?? 'observation'}`;
}

function metricName(record: ObservationMetricRecord): string {
  return record.instrument === 'histogram'
    ? 'repoctopus.work.execution.duration'
    : 'repoctopus.work.execution.events';
}

function spanTimes(record: ObservationSpanRecord, metric?: ObservationMetricRecord) {
  const end = new Date(record.observedAt);
  const duration =
    record.strategy === 'boundary-end' && metric?.instrument === 'histogram' ? metric.value : 0;
  return {
    startTime: new Date(end.getTime() - duration).toISOString(),
    endTime: end.toISOString(),
  };
}

/**
 * Encodes canonical envelopes into destination-neutral OTLP semantic records.
 * Endpoint, headers, batching and retry policy are intentionally absent.
 */
export function encodeObservationEnvelopes(
  envelopes: readonly ObservationEnvelope[],
): EncodedObservationSignals {
  const logs: EncodedOtlpLog[] = [];
  const spans: EncodedOtlpSpan[] = [];
  const metrics: EncodedOtlpMetric[] = [];
  for (const envelope of envelopes) {
    const metric = envelope.records.find(
      (record): record is ObservationMetricRecord => record.signal === 'metric',
    );
    for (const record of envelope.records) {
      const base = {
        observedAt: record.observedAt,
        resourceAttributes: envelope.resource.attributes,
        scope: envelope.scope,
      };
      if (record.signal === 'log') {
        logs.push({
          ...base,
          eventName: `repoctopus.${record.name}`,
          body: `Repoctopus workflow event: ${record.name}`,
          traceId: record.traceId,
          spanId: record.spanId,
          attributes: correlatedAttributes(envelope, record.attributes),
        });
      } else if (record.signal === 'span' && record.strategy !== 'boundary-start') {
        const times = spanTimes(record, metric);
        spans.push({
          ...base,
          name: spanName(record),
          traceId: record.traceId,
          spanId: record.spanId,
          ...times,
          result:
            typeof record.attributes['repoctopus.execution.result'] === 'string'
              ? record.attributes['repoctopus.execution.result']
              : null,
          attributes: {
            ...correlatedAttributes(envelope, record.attributes),
            ...(record.strategy === 'boundary-end' && metric?.instrument === 'histogram'
              ? { 'repoctopus.execution.duration_ms': metric.value }
              : {}),
          },
        });
      } else if (record.signal === 'metric') {
        metrics.push({
          ...base,
          name: metricName(record),
          instrument: record.instrument,
          value: record.value,
          attributes: metricAttributes(record),
        });
      }
    }
  }
  return { logs, spans, metrics };
}
