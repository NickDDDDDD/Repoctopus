import { createHash } from 'node:crypto';

import type { TelemetryBatch, TelemetryPort } from '../../domains/runtime/types.js';
import type { ObservationAttributeValue } from '../../domains/telemetry/observation-envelope.js';
import { acceptedChangeLifecycleTelemetry } from './change-lifecycle-mapping.js';
import { mapWorkflowObservationEnvelopes } from './workflow-observation-mapping.js';
import { mapTelemetryPipelineObservationEnvelopes } from './platform-observation-mapping.js';
import {
  encodeObservationEnvelopes,
  type EncodedObservationSignals,
} from './opentelemetry/envelope-encoder.js';

type Headers = Readonly<Record<string, string>>;

export interface CanonicalOtlpJsonExporterOptions {
  endpoint: string;
  headers?: Headers;
  timeoutMillis?: number;
  fetch?: typeof fetch;
}

export interface TelemetryFanoutResult {
  destinationId: string;
  result: 'delivered' | 'failed';
  observedAt: string;
  error?: string;
}

export interface NamedTelemetryDestination {
  destinationId: string;
  telemetry: TelemetryPort;
}

function nanos(timestamp: string): string {
  return (BigInt(new Date(timestamp).getTime()) * 1_000_000n).toString();
}

function anyValue(value: ObservationAttributeValue): Record<string, string | number | boolean> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

function attributes(values: Readonly<Record<string, ObservationAttributeValue>>) {
  return Object.entries(values).map(([key, value]) => ({ key, value: anyValue(value) }));
}

function resource(attributes_: Readonly<Record<string, ObservationAttributeValue>>) {
  return { attributes: attributes(attributes_) };
}

function scope(name: string, version: string) {
  return { name, version };
}

export function encodeOtlpJsonRequests(signals: EncodedObservationSignals): Readonly<{
  traces: object;
  logs: object;
  metrics: object;
}> {
  return {
    traces: {
      resourceSpans: signals.spans.map((record) => ({
        resource: resource(record.resourceAttributes),
        scopeSpans: [
          {
            scope: scope(record.scope.name, record.scope.version),
            spans: [
              {
                traceId: record.traceId,
                spanId: record.spanId,
                name: record.name,
                startTimeUnixNano: nanos(record.startTime),
                endTimeUnixNano: nanos(record.endTime),
                attributes: attributes(record.attributes),
                status: {
                  code: record.result === 'failed' || record.result === 'rejected' ? 2 : 1,
                },
              },
            ],
          },
        ],
      })),
    },
    logs: {
      resourceLogs: signals.logs.map((record) => ({
        resource: resource(record.resourceAttributes),
        scopeLogs: [
          {
            scope: scope(record.scope.name, record.scope.version),
            logRecords: [
              {
                timeUnixNano: nanos(record.observedAt),
                observedTimeUnixNano: nanos(record.observedAt),
                severityNumber: 9,
                eventName: record.eventName,
                body: { stringValue: record.body },
                attributes: attributes(record.attributes),
                traceId: record.traceId,
                spanId: record.spanId,
              },
            ],
          },
        ],
      })),
    },
    metrics: {
      resourceMetrics: signals.metrics.map((record) => {
        const point = {
          timeUnixNano: nanos(record.observedAt),
          attributes: attributes(record.attributes),
        };
        const metric =
          record.instrument === 'counter'
            ? {
                name: record.name,
                sum: {
                  aggregationTemporality: 1,
                  isMonotonic: true,
                  dataPoints: [{ ...point, asDouble: record.value }],
                },
              }
            : record.instrument === 'histogram'
              ? {
                  name: record.name,
                  histogram: {
                    aggregationTemporality: 1,
                    dataPoints: [
                      {
                        ...point,
                        count: '1',
                        sum: record.value,
                        bucketCounts: ['1'],
                        explicitBounds: [],
                      },
                    ],
                  },
                }
              : {
                  name: record.name,
                  gauge: { dataPoints: [{ ...point, asDouble: record.value }] },
                };
        return {
          resource: resource(record.resourceAttributes),
          scopeMetrics: [
            {
              scope: scope(record.scope.name, record.scope.version),
              metrics: [metric],
            },
          ],
        };
      }),
    },
  };
}

function scalarAttributes(
  values: Readonly<Record<string, unknown>>,
): Readonly<Record<string, ObservationAttributeValue>> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, ObservationAttributeValue] =>
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean',
    ),
  );
}

/** Encodes the complete canonical Run view, including authoritative lifecycle facts. */
export function encodeTelemetryBatchOtlpJsonRequests(batch: TelemetryBatch) {
  const signals = encodeObservationEnvelopes([
    ...mapWorkflowObservationEnvelopes(batch),
    ...mapTelemetryPipelineObservationEnvelopes(batch),
  ]);
  const lifecycleLogs = batch.events.flatMap((event) =>
    acceptedChangeLifecycleTelemetry(batch, event).map((record) => ({
      observedAt: record.timestamp,
      resourceAttributes: {
        'service.name': 'repoctopus-runtime',
        'service.version': '0.1.0',
        'repoctopus.workspace.id': batch.projectSnapshot.projectId,
      },
      scope: { schemaVersion: 1 as const, name: 'io.repoctopus.observation' as const, version: '1.0.0' as const },
      eventName: record.eventName,
      body: record.body,
      traceId: batch.run.traceId,
      spanId: createHash('sha256')
        .update(`${record.eventId}\0${record.signal}`)
        .digest('hex')
        .slice(0, 16),
      attributes: scalarAttributes(record.attributes),
    })),
  );
  return encodeOtlpJsonRequests({ ...signals, logs: [...signals.logs, ...lifecycleLogs] });
}

function signalUrl(endpoint: string, signal: 'traces' | 'logs' | 'metrics'): string {
  const base = new URL(endpoint);
  base.pathname = `${base.pathname.replace(/\/$/u, '')}/v1/${signal}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

/** Sends only the destination-neutral canonical envelope projection as OTLP/HTTP JSON. */
export class CanonicalOtlpJsonExporter implements TelemetryPort {
  readonly #endpoint: string;
  readonly #headers: Headers;
  readonly #timeoutMillis: number;
  readonly #fetch: typeof fetch;

  constructor(options: CanonicalOtlpJsonExporterOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      throw new Error('OTLP endpoint must use HTTP or HTTPS');
    }
    this.#endpoint = endpoint.toString();
    this.#headers = { ...(options.headers ?? {}) };
    this.#timeoutMillis = options.timeoutMillis ?? 5_000;
    this.#fetch = options.fetch ?? fetch;
  }

  async export(batch: TelemetryBatch): Promise<void> {
    const requests = encodeTelemetryBatchOtlpJsonRequests(batch);
    await Promise.all(
      (['traces', 'logs', 'metrics'] as const).map(async (signal) => {
        const response = await this.#fetch(signalUrl(this.#endpoint, signal), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...this.#headers,
          },
          body: JSON.stringify(requests[signal]),
          signal: AbortSignal.timeout(this.#timeoutMillis),
        });
        if (!response.ok) {
          throw new Error(`OTLP ${signal} destination returned HTTP ${response.status}`);
        }
      }),
    );
  }
}

/**
 * Runs destinations independently. Telemetry is observational, so a destination
 * failure is retained as health state and never changes the domain Run result.
 */
export class IsolatedTelemetryFanout implements TelemetryPort {
  readonly #destinations: readonly NamedTelemetryDestination[];
  #latest: readonly TelemetryFanoutResult[] = [];

  constructor(destinations: readonly NamedTelemetryDestination[]) {
    const identities = new Set<string>();
    for (const destination of destinations) {
      if (!destination.destinationId.trim() || identities.has(destination.destinationId)) {
        throw new Error('Telemetry destination identities must be unique and non-empty');
      }
      identities.add(destination.destinationId);
    }
    this.#destinations = [...destinations];
  }

  latestResults(): readonly TelemetryFanoutResult[] {
    return structuredClone(this.#latest);
  }

  async export(batch: TelemetryBatch): Promise<void> {
    const settled = await Promise.allSettled(
      this.#destinations.map((destination) => destination.telemetry.export(batch)),
    );
    const observedAt = new Date().toISOString();
    this.#latest = settled.map((result, index) => ({
      destinationId: this.#destinations[index]!.destinationId,
      result: result.status === 'fulfilled' ? 'delivered' : 'failed',
      observedAt,
      ...(result.status === 'rejected'
        ? { error: result.reason instanceof Error ? result.reason.message : String(result.reason) }
        : {}),
    }));
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      this.#destinations.map(async (destination) => {
        await destination.telemetry.shutdown?.();
      }),
    );
  }
}
