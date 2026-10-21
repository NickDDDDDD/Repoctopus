import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace, type Context } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import { createHash, randomBytes } from 'node:crypto';

import type { TelemetryBatch, TelemetryPort } from '../../../domains/runtime/types.js';
import type { DeliveryEvent, DeliveryTelemetryPort } from '../../../domains/delivery/ports.js';
import type { DeliveryState } from '../../../domains/delivery/types.js';
import { safeDeliveryAttributes } from '../delivery-mapping.js';
import {
  eventSeverity,
  safeEventAttributes,
  workflowEventMetricAttributes,
  workflowStepMetricAttributes,
} from './mapping.js';
import type {
  LifecycleTelemetryEvent,
  LifecycleTelemetryPort,
} from '../../../services/lifecycle-diagnostics.js';

function syntheticParentContext(runId: string, traceId: string): Context {
  const spanId = createHash('sha256').update(runId).digest('hex').slice(0, 16);
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

function rootSpanId(runId: string): string {
  return createHash('sha256').update(runId).digest('hex').slice(0, 16);
}

function actionId(event: TelemetryBatch['events'][number]): string | undefined {
  const value = event.data.actionId;
  return typeof value === 'string' ? value : undefined;
}

function proposedActionId(event: TelemetryBatch['events'][number]): string | undefined {
  const action = event.data.action;
  if (!action || typeof action !== 'object') return undefined;
  const value = (action as Record<string, unknown>).id;
  return typeof value === 'string' ? value : undefined;
}

export interface OpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
}

export class OpenTelemetryExporter implements TelemetryPort {
  constructor(private readonly options: OpenTelemetryOptions = {}) {}

  async export(batch: TelemetryBatch): Promise<void> {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-runtime',
      [ATTR_SERVICE_VERSION]: '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.options.environment ?? 'development',
    });
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const exportsRoot = batch.events.some((event) => event.type === 'run.started');
    let rootIdPending = exportsRoot;
    const traceProvider = new BasicTracerProvider({
      resource,
      idGenerator: {
        generateTraceId: () => batch.run.traceId,
        generateSpanId: () => {
          if (rootIdPending) {
            rootIdPending = false;
            return rootSpanId(batch.run.runId);
          }
          return randomBytes(8).toString('hex');
        },
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

    const tracer = traceProvider.getTracer('repoctopus-runtime', '0.1.0');
    const logger = loggerProvider.getLogger('repoctopus-runtime', '0.1.0');
    const meter = meterProvider.getMeter('repoctopus-runtime', '0.1.0');
    const eventCounter = meter.createCounter('repoctopus.workflow.events', {
      description: 'Number of Repoctopus workflow events exported',
      unit: '{event}',
    });
    const stepDuration = meter.createHistogram('repoctopus.workflow.step.duration', {
      description: 'Completed Repoctopus workflow step duration',
      unit: 'ms',
    });
    const parentContext = syntheticParentContext(batch.run.runId, batch.run.traceId);

    try {
      const started = batch.events.find((event) => event.type === 'run.started');
      if (started) {
        const rootSpan = tracer.startSpan(
          'repoctopus.run',
          {
            startTime: new Date(started.timestamp),
            attributes: safeEventAttributes(batch, started),
          },
          ROOT_CONTEXT,
        );
        rootSpan.setStatus({ code: SpanStatusCode.OK });
        rootSpan.end(new Date(started.timestamp));
      }
      for (const item of batch.events) {
        const attributes = safeEventAttributes(batch, item);
        if (item.type === 'action.completed') {
          const id = actionId(item);
          const proposed = batch.trajectory.find(
            (candidate) =>
              candidate.type === 'action.proposed' && proposedActionId(candidate) === id,
          );
          const startedAt = proposed ? new Date(proposed.timestamp) : new Date(item.timestamp);
          const endedAt = new Date(item.timestamp);
          const duration = Math.max(0, endedAt.getTime() - startedAt.getTime());
          attributes['repoctopus.action.duration_ms'] = duration;
          if (id) attributes['repoctopus.action.retry_count'] = batch.run.retries[id] ?? 0;
          const span = tracer.startSpan(
            'repoctopus.step',
            { startTime: startedAt, attributes },
            parentContext,
          );
          span.setStatus({
            code: item.data.result === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          });
          span.end(endedAt);
          stepDuration.record(duration, workflowStepMetricAttributes(batch, item));
        }

        logger.emit({
          eventName: `repoctopus.${item.type}`,
          timestamp: new Date(item.timestamp),
          severityNumber: eventSeverity(item.type),
          body: `Repoctopus workflow event: ${item.type}`,
          attributes,
          context: parentContext,
        });
        eventCounter.add(1, workflowEventMetricAttributes(batch, item));
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

export class InMemoryTelemetryExporter implements TelemetryPort {
  readonly batches: TelemetryBatch[] = [];

  export(batch: TelemetryBatch): Promise<void> {
    this.batches.push(structuredClone(batch));
    return Promise.resolve();
  }
}

export class OpenTelemetryLifecycleExporter implements LifecycleTelemetryPort {
  constructor(private readonly options: OpenTelemetryOptions = {}) {}

  async export(events: readonly LifecycleTelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-lifecycle',
      [ATTR_SERVICE_VERSION]: '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.options.environment ?? 'development',
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
    const logger = loggerProvider.getLogger('repoctopus-lifecycle', '0.1.0');
    const counter = meterProvider
      .getMeter('repoctopus-lifecycle', '0.1.0')
      .createCounter('repoctopus.lifecycle.events', { unit: '{event}' });
    try {
      for (const event of events) {
        const attributes = {
          'repoctopus.boot.id': event.bootId,
          'repoctopus.composition.digest': event.compositionDigest,
          'repoctopus.lifecycle.type': event.type,
          'repoctopus.lifecycle.phase': event.phase,
          'repoctopus.lifecycle.result': event.result,
          ...(event.pluginId ? { 'repoctopus.plugin.id': event.pluginId } : {}),
          ...(event.service ? { 'repoctopus.service.name': event.service } : {}),
          ...(event.remaining !== undefined
            ? { 'repoctopus.operation.remaining': event.remaining }
            : {}),
          ...(event.recoverability
            ? { 'repoctopus.operation.recoverability': event.recoverability }
            : {}),
        };
        logger.emit({
          eventName: `repoctopus.${event.type}`,
          timestamp: new Date(event.timestamp),
          severityNumber: event.result === 'failed' || event.result === 'timed_out' ? 13 : 9,
          body: `Repoctopus lifecycle event: ${event.type}`,
          attributes,
        });
        counter.add(1, {
          'repoctopus.lifecycle.type': event.type,
          'repoctopus.lifecycle.phase': event.phase,
          'repoctopus.lifecycle.result': event.result,
        });
      }
      await Promise.all([
        loggerProvider.forceFlush({ timeoutMillis }),
        meterProvider.forceFlush({ timeoutMillis }),
      ]);
    } finally {
      await Promise.allSettled([loggerProvider.shutdown(), meterProvider.shutdown()]);
    }
  }
}

export class InMemoryLifecycleTelemetryExporter implements LifecycleTelemetryPort {
  readonly events: LifecycleTelemetryEvent[] = [];

  export(events: readonly LifecycleTelemetryEvent[]): Promise<void> {
    this.events.push(...events.map((event) => structuredClone(event)));
    return Promise.resolve();
  }
}

export class OpenTelemetryDeliveryExporter implements DeliveryTelemetryPort {
  constructor(private readonly options: OpenTelemetryOptions = {}) {}

  async export(state: DeliveryState, event: DeliveryEvent): Promise<void> {
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-delivery',
      [ATTR_SERVICE_VERSION]: '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.options.environment ?? 'development',
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
    try {
      const attributes = safeDeliveryAttributes(state, event);
      loggerProvider.getLogger('repoctopus-delivery', '0.1.0').emit({
        eventName: `repoctopus.${event.type}`,
        timestamp: new Date(event.timestamp),
        severityNumber: 9,
        body: `Repoctopus delivery event: ${event.type}`,
        attributes,
      });
      meterProvider
        .getMeter('repoctopus-delivery', '0.1.0')
        .createCounter('repoctopus.delivery.events', { unit: '{event}' })
        .add(1, {
          'repoctopus.delivery.event.type': event.type,
          'repoctopus.delivery.state': state.status,
        });
      await Promise.all([
        loggerProvider.forceFlush({ timeoutMillis }),
        meterProvider.forceFlush({ timeoutMillis }),
      ]);
    } finally {
      await Promise.allSettled([loggerProvider.shutdown(), meterProvider.shutdown()]);
    }
  }
}

export function telemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TelemetryPort {
  const endpoint =
    environment.OTEL_EXPORTER_OTLP_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (!endpoint) {
    return { async export() {} };
  }
  const options: OpenTelemetryOptions = {};
  if (!environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')) {
    options.environment = environment.REPOCTOPUS_ENVIRONMENT ?? 'development';
  }
  return new OpenTelemetryExporter(options);
}

export function deliveryTelemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeliveryTelemetryPort {
  const endpoint =
    environment.OTEL_EXPORTER_OTLP_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (!endpoint) return { async export() {} };
  const options: OpenTelemetryOptions = {};
  if (!environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')) {
    options.environment = environment.REPOCTOPUS_ENVIRONMENT ?? 'development';
  }
  return new OpenTelemetryDeliveryExporter(options);
}

export function lifecycleTelemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): LifecycleTelemetryPort {
  const endpoint =
    environment.OTEL_EXPORTER_OTLP_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (!endpoint) return { async export() {} };
  const options: OpenTelemetryOptions = {};
  if (!environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')) {
    options.environment = environment.REPOCTOPUS_ENVIRONMENT ?? 'development';
  }
  return new OpenTelemetryLifecycleExporter(options);
}
