import { createHash } from 'node:crypto';

import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import type { DesktopTelemetryEndpoint } from '../../services/desktop-telemetry-receiver.js';

interface OtlpAttribute {
  key: string;
  value: { stringValue: string } | { boolValue: boolean } | { intValue: string } | {
    doubleValue: number;
  };
}

type TraceSignal = Extract<ObservationSignal, { kind: 'trace' }>;
type LogSignal = Extract<ObservationSignal, { kind: 'log' }>;
type MetricSignal = Extract<ObservationSignal, { kind: 'metric' }>;

function attribute(key: string, value: ObservationAttributeValue): OtlpAttribute {
  if (typeof value === 'string') return { key, value: { stringValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return Number.isSafeInteger(value)
    ? { key, value: { intValue: String(value) } }
    : { key, value: { doubleValue: value } };
}

function recordAttributes(envelope: ObservationEnvelope): OtlpAttribute[] {
  const values: Record<string, ObservationAttributeValue> = {
    ...envelope.attributes,
    'repoctopus.telemetry.schema.version': envelope.schemaVersion,
    'repoctopus.envelope.id': envelope.envelopeId,
    'repoctopus.envelope.digest': envelope.digest,
    'repoctopus.stream.id':
      typeof envelope.attributes['repoctopus.run.id'] === 'string'
        ? envelope.attributes['repoctopus.run.id']
        : envelope.source.domain,
    'repoctopus.event.id': envelope.source.eventId,
    'repoctopus.event.type': envelope.source.eventType,
    'repoctopus.event.sequence': envelope.source.sequence ?? 0,
    'repoctopus.observed_at': envelope.observedAt,
  };
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => attribute(key, value));
}

function unixNano(timestamp: string): string {
  return String(BigInt(Date.parse(timestamp)) * 1_000_000n);
}

function signalGroups(envelope: ObservationEnvelope): {
  traces: TraceSignal[];
  logs: LogSignal[];
  metrics: MetricSignal[];
} {
  return {
    traces: envelope.signals.filter((signal): signal is TraceSignal => signal.kind === 'trace'),
    logs: envelope.signals.filter((signal): signal is LogSignal => signal.kind === 'log'),
    metrics: envelope.signals.filter((signal): signal is MetricSignal => signal.kind === 'metric'),
  };
}

function tracePayload(envelopes: readonly ObservationEnvelope[]): unknown {
  const spans = envelopes.flatMap((envelope) => {
    const digest = createHash('sha256').update(envelope.envelopeId).digest('hex');
    return signalGroups(envelope).traces.map((signal) => ({
      traceId: digest.slice(0, 32),
      spanId: digest.slice(32, 48),
      name: signal.name,
      kind: 1,
      startTimeUnixNano: unixNano(envelope.observedAt),
      endTimeUnixNano: unixNano(envelope.observedAt),
      attributes: recordAttributes(envelope),
      status: { code: 1 },
    }));
  });
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', 'repoctopus-runtime')] },
        scopeSpans: [{ scope: { name: 'repoctopus-runtime', version: '0.1.0' }, spans }],
      },
    ],
  };
}

function logPayload(envelopes: readonly ObservationEnvelope[]): unknown {
  const logRecords = envelopes.flatMap((envelope) =>
    signalGroups(envelope).logs.map((signal) => ({
      timeUnixNano: unixNano(envelope.observedAt),
      observedTimeUnixNano: unixNano(envelope.observedAt),
      severityNumber: signal.severity === 'error' ? 17 : signal.severity === 'warn' ? 13 : 9,
      eventName: signal.name,
      body: { stringValue: `Repoctopus event: ${envelope.source.eventType}` },
      attributes: recordAttributes(envelope),
    })),
  );
  return {
    resourceLogs: [
      {
        resource: { attributes: [attribute('service.name', 'repoctopus-runtime')] },
        scopeLogs: [{ scope: { name: 'repoctopus-runtime', version: '0.1.0' }, logRecords }],
      },
    ],
  };
}

function metricPayload(envelopes: readonly ObservationEnvelope[]): unknown {
  const metrics = envelopes.flatMap((envelope) =>
    signalGroups(envelope).metrics.map((signal) => ({
      name: signal.name,
      unit: signal.unit,
      gauge: {
        dataPoints: [
          {
            timeUnixNano: unixNano(envelope.observedAt),
            asDouble: signal.value,
            attributes: [attribute('repoctopus.event.type', envelope.source.eventType)],
          },
        ],
      },
    })),
  );
  return {
    resourceMetrics: [
      {
        resource: { attributes: [attribute('service.name', 'repoctopus-runtime')] },
        scopeMetrics: [{ scope: { name: 'repoctopus-runtime', version: '0.1.0' }, metrics }],
      },
    ],
  };
}

export class ObservationOtlpJsonDestination {
  constructor(
    private readonly endpoint: DesktopTelemetryEndpoint,
    private readonly timeoutMs = 5_000,
  ) {}

  async deliver(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    const groups = [
      {
        path: '/v1/traces',
        active: envelopes.some((envelope) => signalGroups(envelope).traces.length > 0),
        payload: () => tracePayload(envelopes),
      },
      {
        path: '/v1/logs',
        active: envelopes.some((envelope) => signalGroups(envelope).logs.length > 0),
        payload: () => logPayload(envelopes),
      },
      {
        path: '/v1/metrics',
        active: envelopes.some((envelope) => signalGroups(envelope).metrics.length > 0),
        payload: () => metricPayload(envelopes),
      },
    ].filter((group) => group.active);
    await Promise.all(
      groups.map(async (group) => {
        const response = await fetch(new URL(group.path, this.endpoint.origin), {
          method: 'POST',
          headers: {
            authorization: this.endpoint.authorization,
            'content-type': 'application/json',
          },
          body: JSON.stringify(group.payload()),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) throw new Error(`OTLP destination rejected ${group.path}`);
      }),
    );
  }
}
