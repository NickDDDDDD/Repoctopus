import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { createHash } from 'node:crypto';

import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryPort,
} from '../../../domains/evidence/telemetry.js';
import { safeEvidenceAttributes } from '../evidence-mapping.js';

export interface EvidenceOpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
}

function parentContext(batch: EvidenceTelemetryBatch) {
  const rootIdentity = batch.runId ?? batch.attemptId;
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: createHash('sha256').update(rootIdentity).digest('hex').slice(0, 32),
    spanId: createHash('sha256').update(batch.attemptId).digest('hex').slice(0, 16),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

export class OpenTelemetryEvidenceExporter implements EvidenceTelemetryPort {
  constructor(private readonly options: EvidenceOpenTelemetryOptions = {}) {}

  async export(batch: EvidenceTelemetryBatch): Promise<void> {
    if (batch.events.length === 0) return;
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-evidence',
      [ATTR_SERVICE_VERSION]: '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.options.environment ?? 'development',
    });
    const traceProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ timeoutMillis }))],
    });
    const loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new SimpleLogRecordProcessor({ exporter: new OTLPLogExporter({ timeoutMillis }) }),
      ],
    });
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ timeoutMillis }),
      exportIntervalMillis: 60_000,
      exportTimeoutMillis: timeoutMillis,
    });
    const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
    const tracer = traceProvider.getTracer('repoctopus-evidence', '0.1.0');
    const logger = loggerProvider.getLogger('repoctopus-evidence', '0.1.0');
    const meter = meterProvider.getMeter('repoctopus-evidence', '0.1.0');
    const counter = meter.createCounter('repoctopus.evidence.events', { unit: '{event}' });
    const duration = meter.createHistogram('repoctopus.evidence.node.duration', { unit: 'ms' });
    const parent = parentContext(batch);
    try {
      for (const event of batch.events) {
        const attributes = safeEvidenceAttributes(batch, event);
        if (event.type === 'evidence.attempt.started' || event.type === 'evidence.node.completed') {
          const span = tracer.startSpan(
            event.type === 'evidence.attempt.started'
              ? 'repoctopus.evidence.attempt'
              : 'repoctopus.evidence.node',
            { startTime: new Date(event.timestamp), attributes },
            parent,
          );
          span.setStatus({
            code:
              event.data.status === 'failed' || event.data.status === 'incomplete'
                ? SpanStatusCode.ERROR
                : SpanStatusCode.OK,
          });
          span.end(new Date(event.timestamp));
        }
        logger.emit({
          eventName: event.type,
          timestamp: new Date(event.timestamp),
          body: `Repoctopus Evidence event: ${event.type}`,
          attributes,
          context: parent,
        });
        counter.add(1, { 'repoctopus.evidence.event.type': event.type });
        if (event.type === 'evidence.node.completed' && typeof event.data.durationMs === 'number') {
          duration.record(event.data.durationMs, {
            'repoctopus.evidence.adapter': String(event.data.adapter ?? 'unknown'),
            'repoctopus.evidence.status': String(event.data.status ?? 'unknown'),
          });
        }
      }
      await Promise.all([
        traceProvider.forceFlush({ timeoutMillis }),
        loggerProvider.forceFlush({ timeoutMillis }),
        meterProvider.forceFlush({ timeoutMillis }),
      ]);
    } finally {
      await Promise.allSettled([
        traceProvider.shutdown(),
        loggerProvider.shutdown(),
        meterProvider.shutdown(),
      ]);
    }
  }
}

export class InMemoryEvidenceTelemetryExporter implements EvidenceTelemetryPort {
  readonly batches: EvidenceTelemetryBatch[] = [];

  export(batch: EvidenceTelemetryBatch): Promise<void> {
    this.batches.push(structuredClone(batch));
    return Promise.resolve();
  }
}

export function evidenceTelemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): EvidenceTelemetryPort {
  const endpoint =
    environment.OTEL_EXPORTER_OTLP_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (!endpoint) return { async export() {} };
  const options: EvidenceOpenTelemetryOptions = {};
  if (!environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')) {
    options.environment = environment.REPOCTOPUS_ENVIRONMENT ?? 'development';
  }
  return new OpenTelemetryEvidenceExporter(options);
}
