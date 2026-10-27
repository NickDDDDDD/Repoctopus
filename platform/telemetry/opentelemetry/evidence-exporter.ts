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
import { mapEvidenceObservationEnvelopes } from '../evidence-observation-mapping.js';
import { encodeObservationEnvelopes } from './envelope-encoder.js';
import { remoteTelemetryEnabled } from '../environment-configuration.js';

export interface EvidenceOpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
}

function observationContext(traceId: string, spanId: string) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

function parentContext(traceId: string, attemptId: string) {
  return observationContext(
    traceId,
    createHash('sha256').update(`${attemptId}\0evidence-root`).digest('hex').slice(0, 16),
  );
}

export class OpenTelemetryEvidenceExporter implements EvidenceTelemetryPort {
  constructor(private readonly options: EvidenceOpenTelemetryOptions = {}) {}

  async export(batch: EvidenceTelemetryBatch): Promise<void> {
    if (batch.events.length === 0) return;
    const signals = encodeObservationEnvelopes(mapEvidenceObservationEnvelopes(batch));
    const traceId = signals.logs[0]?.traceId;
    if (!traceId) return;
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-evidence',
      [ATTR_SERVICE_VERSION]: '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.options.environment ?? 'development',
    });
    let spanCursor = 0;
    const traceProvider = new BasicTracerProvider({
      resource,
      idGenerator: {
        generateTraceId: () => traceId,
        generateSpanId: () =>
          signals.spans[spanCursor++]?.spanId ??
          createHash('sha256')
            .update(`${batch.attemptId}\0fallback\0${spanCursor}`)
            .digest('hex')
            .slice(0, 16),
      },
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
    const tracer = traceProvider.getTracer('io.repoctopus.observation', '1.0.0');
    const logger = loggerProvider.getLogger('io.repoctopus.observation', '1.0.0');
    const meter = meterProvider.getMeter('io.repoctopus.observation', '1.0.0');
    const counter = meter.createCounter('repoctopus.evidence.events', { unit: '{event}' });
    const duration = meter.createHistogram('repoctopus.evidence.node.duration', { unit: 'ms' });
    const attemptDuration = meter.createHistogram('repoctopus.evidence.attempt.duration', {
      unit: 'ms',
    });
    const parent = parentContext(traceId, batch.attemptId);
    try {
      for (const record of signals.spans) {
        const span = tracer.startSpan(
          record.name,
          { startTime: new Date(record.startTime), attributes: record.attributes },
          parent,
        );
        span.setStatus({
          code:
            record.result === 'failed' ||
            record.result === 'incomplete' ||
            record.result === 'blocked' ||
            record.result === 'superseded'
              ? SpanStatusCode.ERROR
              : SpanStatusCode.OK,
        });
        span.end(new Date(record.endTime));
      }
      for (const record of signals.logs) {
        logger.emit({
          eventName: record.eventName,
          timestamp: new Date(record.observedAt),
          body: record.body,
          attributes: record.attributes,
          context: observationContext(record.traceId, record.spanId),
        });
      }
      for (const record of signals.metrics) {
        if (record.name === 'repoctopus.evidence.node.duration') {
          duration.record(record.value, record.attributes);
        } else if (record.name === 'repoctopus.evidence.attempt.duration') {
          attemptDuration.record(record.value, record.attributes);
        } else {
          counter.add(record.value, record.attributes);
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
  if (!remoteTelemetryEnabled(environment)) return { async export() {} };
  const options: EvidenceOpenTelemetryOptions = {};
  if (!environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')) {
    options.environment = environment.REPOCTOPUS_ENVIRONMENT ?? 'development';
  }
  return new OpenTelemetryEvidenceExporter(options);
}
