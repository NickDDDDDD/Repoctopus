import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createHash } from 'node:crypto';

import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryPort,
} from '../../../domains/evidence/telemetry.js';
import { safeEvidenceAttributes } from '../evidence-mapping.js';
import { createRepoctopusResource, resolveOtlpDeployment } from './config.js';

export interface EvidenceOpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
  processEnvironment?: NodeJS.ProcessEnv;
}

function deploymentEnvironment(options: EvidenceOpenTelemetryOptions): NodeJS.ProcessEnv {
  const environment = { ...(options.processEnvironment ?? process.env) };
  if (
    options.environment &&
    !environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')
  ) {
    environment.REPOCTOPUS_ENVIRONMENT = options.environment;
  }
  return environment;
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
    const environment = deploymentEnvironment(this.options);
    const deployment = resolveOtlpDeployment(environment);
    if (!deployment.enabled) return;
    const resource = createRepoctopusResource('repoctopus-evidence', '0.1.0', environment);
    const traceTimeout = this.options.timeoutMillis ?? deployment.traces.timeoutMillis;
    const logTimeout = this.options.timeoutMillis ?? deployment.logs.timeoutMillis;
    const metricTimeout = this.options.timeoutMillis ?? deployment.metrics.timeoutMillis;
    const traceProvider = deployment.traces.enabled
      ? new BasicTracerProvider({
          resource,
          spanProcessors: [
            new SimpleSpanProcessor(
              new OTLPTraceExporter({
                url: deployment.traces.url!,
                headers: deployment.traces.headers,
                timeoutMillis: traceTimeout,
              }),
            ),
          ],
        })
      : null;
    const loggerProvider = deployment.logs.enabled
      ? new LoggerProvider({
          resource,
          processors: [
            new SimpleLogRecordProcessor({
              exporter: new OTLPLogExporter({
                url: deployment.logs.url!,
                headers: deployment.logs.headers,
                timeoutMillis: logTimeout,
              }),
            }),
          ],
        })
      : null;
    const metricReader = deployment.metrics.enabled
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: deployment.metrics.url!,
            headers: deployment.metrics.headers,
            timeoutMillis: metricTimeout,
          }),
          exportIntervalMillis: 60_000,
          exportTimeoutMillis: metricTimeout,
        })
      : null;
    const meterProvider = metricReader
      ? new MeterProvider({ resource, readers: [metricReader] })
      : null;
    const tracer = traceProvider?.getTracer('repoctopus-evidence', '0.1.0');
    const logger = loggerProvider?.getLogger('repoctopus-evidence', '0.1.0');
    const meter = meterProvider?.getMeter('repoctopus-evidence', '0.1.0');
    const counter = meter?.createCounter('repoctopus.evidence.events', { unit: '{event}' });
    const duration = meter?.createHistogram('repoctopus.evidence.node.duration', { unit: 'ms' });
    const parent = parentContext(batch);
    try {
      for (const event of batch.events) {
        const attributes = safeEvidenceAttributes(batch, event);
        if (event.type === 'evidence.attempt.started' || event.type === 'evidence.node.completed') {
          const span = tracer?.startSpan(
            event.type === 'evidence.attempt.started'
              ? 'repoctopus.evidence.attempt'
              : 'repoctopus.evidence.node',
            { startTime: new Date(event.timestamp), attributes },
            parent,
          );
          span?.setStatus({
            code:
              event.data.status === 'failed' || event.data.status === 'incomplete'
                ? SpanStatusCode.ERROR
                : SpanStatusCode.OK,
          });
          span?.end(new Date(event.timestamp));
        }
        logger?.emit({
          eventName: event.type,
          timestamp: new Date(event.timestamp),
          body: `Repoctopus Evidence event: ${event.type}`,
          attributes,
          context: parent,
        });
        counter?.add(1, { 'repoctopus.evidence.event.type': event.type });
        if (event.type === 'evidence.node.completed' && typeof event.data.durationMs === 'number') {
          duration?.record(event.data.durationMs, {
            'repoctopus.evidence.adapter': String(event.data.adapter ?? 'unknown'),
            'repoctopus.evidence.status': String(event.data.status ?? 'unknown'),
          });
        }
      }
      await Promise.all([
        ...(traceProvider ? [traceProvider.forceFlush({ timeoutMillis: traceTimeout })] : []),
        ...(loggerProvider ? [loggerProvider.forceFlush({ timeoutMillis: logTimeout })] : []),
        ...(meterProvider ? [meterProvider.forceFlush({ timeoutMillis: metricTimeout })] : []),
      ]);
    } finally {
      await Promise.allSettled([
        ...(traceProvider ? [traceProvider.shutdown()] : []),
        ...(loggerProvider ? [loggerProvider.shutdown()] : []),
        ...(meterProvider ? [meterProvider.shutdown()] : []),
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
  if (!resolveOtlpDeployment(environment).enabled) return { async export() {} };
  return new OpenTelemetryEvidenceExporter({ processEnvironment: environment });
}
