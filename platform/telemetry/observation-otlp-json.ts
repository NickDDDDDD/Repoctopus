import { createHash } from 'node:crypto';

import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import type { DesktopTelemetryEndpoint } from '../../services/desktop-telemetry-receiver.js';

interface OtlpAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { boolValue: boolean }
    | { intValue: string }
    | {
        doubleValue: number;
      };
}

type TraceSignal = Extract<ObservationSignal, { kind: 'trace' }>;
type LogSignal = Extract<ObservationSignal, { kind: 'log' }>;
type MetricSignal = Extract<ObservationSignal, { kind: 'metric' }>;
export type ObservationOtlpSignal = 'traces' | 'logs' | 'metrics';

export interface ObservationOtlpTarget {
  url: string;
  headers?: Readonly<Record<string, string>>;
}

export interface ObservationOtlpJsonConfig {
  targets: Partial<Record<ObservationOtlpSignal, ObservationOtlpTarget>>;
  timeoutMs?: number;
}

export interface EncodedObservationOtlpRequest {
  signal: ObservationOtlpSignal;
  payload: Readonly<Record<string, unknown>>;
}

export interface ObservationOtlpDeliveryOptions {
  destinationId: 'desktop-local';
  mode: 'replay';
}

function attribute(key: string, value: ObservationAttributeValue): OtlpAttribute {
  if (typeof value === 'string') return { key, value: { stringValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return Number.isSafeInteger(value)
    ? { key, value: { intValue: String(value) } }
    : { key, value: { doubleValue: value } };
}

function attributes(values: Readonly<Record<string, ObservationAttributeValue>>): OtlpAttribute[] {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => attribute(key, value));
}

function recordAttributes(envelope: ObservationEnvelope): OtlpAttribute[] {
  return attributes({
    ...envelope.attributes,
    'repoctopus.telemetry.schema.version': envelope.schemaVersion,
    'repoctopus.envelope.id': envelope.envelopeId,
    'repoctopus.envelope.digest': envelope.digest,
    'repoctopus.stream.id':
      typeof envelope.attributes['repoctopus.stream.id'] === 'string'
        ? envelope.attributes['repoctopus.stream.id']
        : typeof envelope.attributes['repoctopus.run.id'] === 'string'
          ? envelope.attributes['repoctopus.run.id']
          : envelope.source.domain,
    'repoctopus.event.id': envelope.source.eventId,
    'repoctopus.event.type': envelope.source.eventType,
    'repoctopus.event.sequence': envelope.source.sequence ?? 0,
    'repoctopus.observed_at': envelope.observedAt,
  });
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

function fallbackIds(envelope: ObservationEnvelope): { traceId: string; spanId: string } {
  const digest = createHash('sha256').update(envelope.envelopeId).digest('hex');
  return { traceId: digest.slice(0, 32), spanId: digest.slice(32, 48) };
}

function tracePayload(
  envelopes: readonly ObservationEnvelope[],
): Readonly<Record<string, unknown>> {
  const spans = envelopes.flatMap((envelope) => {
    const fallback = fallbackIds(envelope);
    return signalGroups(envelope).traces.map((signal) => ({
      traceId: signal.traceId ?? fallback.traceId,
      spanId: signal.spanId ?? fallback.spanId,
      ...(signal.parentSpanId === undefined ? {} : { parentSpanId: signal.parentSpanId }),
      name: signal.name,
      kind: 1,
      startTimeUnixNano: unixNano(signal.startedAt ?? envelope.observedAt),
      endTimeUnixNano: unixNano(signal.endedAt ?? envelope.observedAt),
      attributes: recordAttributes(envelope),
      status: { code: signal.status === 'error' ? 2 : 1 },
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

function logPayload(envelopes: readonly ObservationEnvelope[]): Readonly<Record<string, unknown>> {
  const severity = { debug: 5, info: 9, warn: 13, error: 17 } as const;
  const logRecords = envelopes.flatMap((envelope) => {
    const fallback = fallbackIds(envelope);
    return signalGroups(envelope).logs.map((signal) => ({
      timeUnixNano: unixNano(envelope.observedAt),
      observedTimeUnixNano: unixNano(envelope.observedAt),
      severityNumber: severity[signal.severity],
      eventName: signal.name,
      body: { stringValue: `Repoctopus workflow event: ${envelope.source.eventType}` },
      attributes: recordAttributes(envelope),
      traceId: signal.traceId ?? fallback.traceId,
      spanId: signal.spanId ?? fallback.spanId,
    }));
  });
  return {
    resourceLogs: [
      {
        resource: { attributes: [attribute('service.name', 'repoctopus-runtime')] },
        scopeLogs: [{ scope: { name: 'repoctopus-runtime', version: '0.1.0' }, logRecords }],
      },
    ],
  };
}

function metricData(signal: MetricSignal, envelope: ObservationEnvelope): Record<string, unknown> {
  const point = {
    timeUnixNano: unixNano(envelope.observedAt),
    asDouble: signal.value,
    attributes: attributes(signal.attributes ?? {}),
  };
  if (signal.aggregation === 'counter') {
    return {
      sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: [point] },
    };
  }
  if (signal.aggregation === 'histogram') {
    return {
      histogram: {
        aggregationTemporality: 1,
        dataPoints: [
          {
            timeUnixNano: point.timeUnixNano,
            count: '1',
            sum: signal.value,
            min: signal.value,
            max: signal.value,
            bucketCounts: ['1'],
            explicitBounds: [],
            attributes: point.attributes,
          },
        ],
      },
    };
  }
  return { gauge: { dataPoints: [point] } };
}

function metricPayload(
  envelopes: readonly ObservationEnvelope[],
): Readonly<Record<string, unknown>> {
  const metrics = envelopes.flatMap((envelope) =>
    signalGroups(envelope).metrics.map((signal) => ({
      name: signal.name,
      unit: signal.unit,
      ...metricData(signal, envelope),
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

export function encodeObservationOtlpJson(
  envelopes: readonly ObservationEnvelope[],
): EncodedObservationOtlpRequest[] {
  const requests: EncodedObservationOtlpRequest[] = [];
  if (envelopes.some((envelope) => signalGroups(envelope).traces.length > 0)) {
    requests.push({ signal: 'traces', payload: tracePayload(envelopes) });
  }
  if (envelopes.some((envelope) => signalGroups(envelope).logs.length > 0)) {
    requests.push({ signal: 'logs', payload: logPayload(envelopes) });
  }
  if (envelopes.some((envelope) => signalGroups(envelope).metrics.length > 0)) {
    requests.push({ signal: 'metrics', payload: metricPayload(envelopes) });
  }
  return requests;
}

function endpointUrl(origin: string, signal: ObservationOtlpSignal): string {
  const base = origin.endsWith('/') ? origin : `${origin}/`;
  return new URL(`v1/${signal}`, base).href;
}

function desktopConfig(endpoint: DesktopTelemetryEndpoint): ObservationOtlpJsonConfig {
  const target = (signal: ObservationOtlpSignal): ObservationOtlpTarget => ({
    url: endpointUrl(endpoint.origin, signal),
    headers: { authorization: endpoint.authorization },
  });
  return {
    targets: { traces: target('traces'), logs: target('logs'), metrics: target('metrics') },
  };
}

function parseHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!value) return headers;
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator < 1) throw new Error('Invalid OTLP header configuration');
    const key = entry.slice(0, separator).trim().toLowerCase();
    const headerValue = entry.slice(separator + 1).trim();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(key) || !headerValue) {
      throw new Error('Invalid OTLP header configuration');
    }
    headers[key] = headerValue;
  }
  return headers;
}

export function observationOtlpJsonConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ObservationOtlpJsonConfig | null {
  const common = environment.OTEL_EXPORTER_OTLP_ENDPOINT;
  const commonHeaders = parseHeaders(environment.OTEL_EXPORTER_OTLP_HEADERS);
  const configured = (
    signal: ObservationOtlpSignal,
    variable: string,
    headerVariable: string,
  ): ObservationOtlpTarget | undefined => {
    const explicit = environment[variable];
    const url = explicit ?? (common ? endpointUrl(common, signal) : undefined);
    if (!url) return undefined;
    return {
      url: new URL(url).href,
      headers: { ...commonHeaders, ...parseHeaders(environment[headerVariable]) },
    };
  };
  const targets: Partial<Record<ObservationOtlpSignal, ObservationOtlpTarget>> = {};
  const traces = configured(
    'traces',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  );
  const logs = configured(
    'logs',
    'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  );
  const metrics = configured(
    'metrics',
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  );
  if (traces) targets.traces = traces;
  if (logs) targets.logs = logs;
  if (metrics) targets.metrics = metrics;
  if (!targets.traces && !targets.logs && !targets.metrics) return null;
  if (!targets.traces || !targets.logs || !targets.metrics) {
    throw new Error(
      'Workflow OTLP export requires a common endpoint or explicit endpoints for all signals',
    );
  }
  return { targets };
}

export class ObservationOtlpJsonDestination {
  private readonly config: ObservationOtlpJsonConfig;

  constructor(config: ObservationOtlpJsonConfig | DesktopTelemetryEndpoint, timeoutMs?: number) {
    const normalized = 'origin' in config ? desktopConfig(config) : config;
    this.config = timeoutMs === undefined ? normalized : { ...normalized, timeoutMs };
  }

  async deliver(
    envelopes: readonly ObservationEnvelope[],
    delivery?: ObservationOtlpDeliveryOptions,
  ): Promise<void> {
    const requests = encodeObservationOtlpJson(envelopes).filter(
      (request) => this.config.targets[request.signal] !== undefined,
    );
    await Promise.all(
      requests.map(async (request) => {
        const target = this.config.targets[request.signal]!;
        const response = await fetch(target.url, {
          method: 'POST',
          headers: {
            ...target.headers,
            'content-type': 'application/json',
            ...(delivery === undefined
              ? {}
              : {
                  'x-repoctopus-destination-id': delivery.destinationId,
                  'x-repoctopus-delivery-mode': delivery.mode,
                }),
          },
          body: JSON.stringify(request.payload),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 5_000),
        });
        if (!response.ok) throw new Error(`OTLP destination rejected ${request.signal}`);
      }),
    );
  }
}
