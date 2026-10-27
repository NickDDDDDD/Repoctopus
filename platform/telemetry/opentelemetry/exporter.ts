import {
  ROOT_CONTEXT,
  SpanStatusCode,
  TraceFlags,
  trace,
  type Context,
  type Meter,
} from '@opentelemetry/api';
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
import { createHash } from 'node:crypto';

import type { TelemetryBatch, TelemetryPort } from '../../../domains/runtime/types.js';
import type { DeliveryEvent, DeliveryTelemetryPort } from '../../../domains/delivery/ports.js';
import type { DeliveryState } from '../../../domains/delivery/types.js';
import { acceptedChangeLifecycleTelemetry } from '../change-lifecycle-mapping.js';
import {
  eventSeverity,
  executionContextFromEvent,
  executionMetricAttributes,
  safeEventAttributes,
  workflowEventMetricAttributes,
  workflowStepMetricAttributes,
} from './mapping.js';
import type {
  LifecycleTelemetryEvent,
  LifecycleTelemetryPort,
} from '../../../services/lifecycle-diagnostics.js';
import { projectWorkflowHealthMetrics } from '../../../domains/telemetry/workflow-health-metrics.js';
import { mapWorkflowObservationEnvelopes } from '../workflow-observation-mapping.js';
import {
  mapDeliveryObservationEnvelope,
  mapLifecycleObservationEnvelopes,
  mapTelemetryPipelineObservationEnvelopes,
} from '../platform-observation-mapping.js';
import {
  encodeObservationEnvelopes,
  type EncodedObservationSignals,
  type EncodedOtlpMetric,
} from './envelope-encoder.js';

interface MetricInstrumentCache {
  counters: Map<string, ReturnType<Meter['createCounter']>>;
  histograms: Map<string, ReturnType<Meter['createHistogram']>>;
  gauges: Map<string, ReturnType<Meter['createGauge']>>;
}

function metricInstrumentCache(): MetricInstrumentCache {
  return { counters: new Map(), histograms: new Map(), gauges: new Map() };
}

function recordEncodedMetric(
  meter: Meter,
  cache: MetricInstrumentCache,
  record: EncodedOtlpMetric,
): void {
  if (record.instrument === 'counter') {
    let instrument = cache.counters.get(record.name);
    if (!instrument) {
      instrument = meter.createCounter(record.name);
      cache.counters.set(record.name, instrument);
    }
    instrument.add(record.value, record.attributes);
    return;
  }
  if (record.instrument === 'histogram') {
    let instrument = cache.histograms.get(record.name);
    if (!instrument) {
      instrument = meter.createHistogram(record.name);
      cache.histograms.set(record.name, instrument);
    }
    instrument.record(record.value, record.attributes);
    return;
  }
  let instrument = cache.gauges.get(record.name);
  if (!instrument) {
    instrument = meter.createGauge(record.name);
    cache.gauges.set(record.name, instrument);
  }
  instrument.record(record.value, record.attributes);
}

function syntheticParentContext(runId: string, traceId: string): Context {
  const spanId = createHash('sha256').update(runId).digest('hex').slice(0, 16);
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

function observationContext(traceId: string, spanId: string): Context {
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

const EXECUTION_SPAN_START: Partial<
  Record<TelemetryBatch['events'][number]['type'], TelemetryBatch['events'][number]['type']>
> = {
  'work.completed': 'work.claimed',
  'work.host-completed': 'work.host-started',
  'tool.completed': 'tool.started',
  'wait.ended': 'wait.started',
  'decision.resolved': 'decision.requested',
  'validator.completed': 'validator.started',
  'reconcile.completed': 'reconcile.started',
};

function sameExecutionBoundary(
  left: TelemetryBatch['events'][number],
  right: TelemetryBatch['events'][number],
): boolean {
  for (const key of [
    'invocationId',
    'operationId',
    'waitId',
    'reconcileId',
    'decisionId',
  ] as const) {
    const value = left.data[key];
    if (typeof value === 'string') return value === right.data[key];
  }
  const leftContext = executionContextFromEvent(left);
  const rightContext = executionContextFromEvent(right);
  return (
    leftContext !== null &&
    rightContext !== null &&
    leftContext.work.id === rightContext.work.id &&
    leftContext.attempt === rightContext.attempt &&
    leftContext.checkEpoch === rightContext.checkEpoch
  );
}

function executionSpanName(type: TelemetryBatch['events'][number]['type']): string {
  if (type.startsWith('decision.')) return 'repoctopus.decision';
  if (type.startsWith('wait.')) return 'repoctopus.wait';
  if (type.startsWith('work.host-')) return 'repoctopus.host';
  if (type.startsWith('work.')) return 'repoctopus.work';
  if (type.startsWith('tool.')) return 'repoctopus.tool';
  if (type.startsWith('validator.')) return 'repoctopus.validator';
  if (type.startsWith('reconcile.')) return 'repoctopus.reconcile';
  return 'repoctopus.execution';
}

export interface OpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
}

export class OpenTelemetryExporter implements TelemetryPort {
  constructor(private readonly options: OpenTelemetryOptions = {}) {}

  async export(batch: TelemetryBatch): Promise<void> {
    const observationSignalsByEvent = new Map<string, EncodedObservationSignals>();
    for (const envelope of [
      ...mapWorkflowObservationEnvelopes(batch),
      ...mapTelemetryPipelineObservationEnvelopes(batch),
    ]) {
      observationSignalsByEvent.set(
        envelope.source.eventId,
        encodeObservationEnvelopes([envelope]),
      );
    }
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-runtime',
      [ATTR_SERVICE_VERSION]: '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.options.environment ?? 'development',
    });
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const exportsRoot =
      batch.run.status === 'completed' &&
      batch.trajectory.some((event) => event.type === 'run.started');
    const stableSpanIds = [
      ...(exportsRoot ? [rootSpanId(batch.run.runId)] : []),
      ...batch.events.flatMap((event) => {
        const observationSpans = observationSignalsByEvent.get(event.eventId)?.spans ?? [];
        if (observationSpans.length > 0) return observationSpans.map((span) => span.spanId);
        if (
          event.type !== 'action.completed' &&
          event.type !== 'telemetry.delivery-completed' &&
          EXECUTION_SPAN_START[event.type] === undefined
        ) {
          return [];
        }
        return [
          createHash('sha256')
            .update(`${batch.run.runId}\0${event.eventId}\0${event.type}`)
            .digest('hex')
            .slice(0, 16),
        ];
      }),
    ];
    let spanCursor = 0;
    const traceProvider = new BasicTracerProvider({
      resource,
      idGenerator: {
        generateTraceId: () => batch.run.traceId,
        generateSpanId: () =>
          stableSpanIds[spanCursor++] ??
          createHash('sha256')
            .update(`${batch.run.runId}\0fallback\0${spanCursor}`)
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

    const tracer = traceProvider.getTracer('repoctopus-runtime', '0.1.0');
    const logger = loggerProvider.getLogger('repoctopus-runtime', '0.1.0');
    const meter = meterProvider.getMeter('repoctopus-runtime', '0.1.0');
    const observationTracer = traceProvider.getTracer('io.repoctopus.observation', '1.0.0');
    const observationLogger = loggerProvider.getLogger('io.repoctopus.observation', '1.0.0');
    const eventCounter = meter.createCounter('repoctopus.workflow.events', {
      description: 'Number of Repoctopus workflow events exported',
      unit: '{event}',
    });
    const stepDuration = meter.createHistogram('repoctopus.workflow.step.duration', {
      description: 'Completed Repoctopus workflow step duration',
      unit: 'ms',
    });
    const executionCounter = meter.createCounter('repoctopus.work.execution.events', {
      description: 'Committed managed Work execution events',
      unit: '{event}',
    });
    const executionDuration = meter.createHistogram('repoctopus.work.execution.duration', {
      description: 'Managed Work, Host, tool, Validator, wait, and reconcile duration',
      unit: 'ms',
    });
    const workflowHealthDuration = meter.createHistogram('repoctopus.workflow.health.duration', {
      description:
        'Identity-free workflow residency, execution, wait, validation, and recovery time',
      unit: 'ms',
    });
    const workflowHealthEvents = meter.createCounter('repoctopus.workflow.health.events', {
      description: 'Identity-free workflow rework, retry, unknown, reconcile, and recovery events',
      unit: '{event}',
    });
    const toolObservation = meter.createCounter('repoctopus.tool.observations', {
      description: 'Host Tool observation availability reported by managed Work executions',
      unit: '{observation}',
    });
    const toolCalls = meter.createCounter('repoctopus.tool.calls', {
      description: 'Host-declared bounded Tool call aggregate',
      unit: '{call}',
    });
    const toolDuration = meter.createHistogram('repoctopus.tool.duration', {
      description: 'Host-declared bounded Tool duration aggregate',
      unit: 'ms',
    });
    const modelTokens = meter.createCounter('repoctopus.model.tokens', {
      description: 'Host-declared model Token aggregate when available',
      unit: '{token}',
    });
    const observationMetricInstruments = metricInstrumentCache();
    const parentContext = syntheticParentContext(batch.run.runId, batch.run.traceId);

    try {
      const started = batch.trajectory.find((event) => event.type === 'run.started');
      if (started) {
        const lastObservedAt = batch.trajectory.at(-1)?.timestamp ?? batch.run.updatedAt;
        const endedAt = new Date(
          Math.max(Date.parse(batch.run.updatedAt), Date.parse(lastObservedAt)),
        );
        const rootSpan = tracer.startSpan(
          'repoctopus.run',
          {
            startTime: new Date(started.timestamp),
            attributes: safeEventAttributes(batch, started),
          },
          ROOT_CONTEXT,
        );
        rootSpan.setStatus({ code: SpanStatusCode.OK });
        rootSpan.end(endedAt);
      }
      for (const item of batch.events) {
        for (const sample of projectWorkflowHealthMetrics({
          run: batch.run,
          trajectory: batch.trajectory,
          event: item,
        })) {
          const attributes = {
            'repoctopus.health.kind': sample.kind,
            'repoctopus.execution.phase': sample.phase,
            'repoctopus.execution.result': sample.result,
            ...(sample.instrument === 'duration' && sample.validatorFinding
              ? { 'repoctopus.validator.finding.kind': sample.validatorFinding }
              : {}),
          };
          if (sample.instrument === 'duration') {
            workflowHealthDuration.record(sample.durationMs, attributes);
          } else {
            workflowHealthEvents.add(1, attributes);
          }
        }
        const executionContext = executionContextFromEvent(item);
        const phase = executionContext?.phase ?? 'unknown';
        if (item.type === 'tool.observation-reported') {
          const status = item.data.observationStatus;
          if (status === 'observed' || status === 'unknown') {
            toolObservation.add(1, {
              'repoctopus.execution.phase': phase,
              'repoctopus.tool.observation.status': status,
            });
          }
        }
        if (item.type === 'tool.usage-reported') {
          const category = item.data.toolCategory;
          const result = item.data.result;
          const callCount = item.data.callCount;
          const durationMs = item.data.durationMs;
          if (
            typeof category === 'string' &&
            [
              'repository.read',
              'repository.search',
              'code.edit',
              'test.run',
              'git.inspect',
              'git.publish',
              'external.request',
            ].includes(category) &&
            (result === 'succeeded' || result === 'failed' || result === 'unknown') &&
            typeof callCount === 'number' &&
            Number.isSafeInteger(callCount) &&
            callCount > 0 &&
            typeof durationMs === 'number' &&
            Number.isSafeInteger(durationMs) &&
            durationMs >= 0
          ) {
            const metricAttributes = {
              'repoctopus.execution.phase': phase,
              'repoctopus.tool.category': category,
              'repoctopus.tool.result': result,
            };
            toolCalls.add(callCount, metricAttributes);
            toolDuration.record(durationMs, metricAttributes);
          }
        }
        if (item.type === 'model.usage-reported') {
          for (const [source, kind] of [
            ['inputTokenCount', 'input'],
            ['outputTokenCount', 'output'],
            ['cacheReadTokenCount', 'cache-read'],
            ['cacheWriteTokenCount', 'cache-write'],
          ] as const) {
            const value = item.data[source];
            if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
              modelTokens.add(value, {
                'repoctopus.execution.phase': phase,
                'repoctopus.model.token.kind': kind,
              });
            }
          }
        }
        const lifecycleRecords = acceptedChangeLifecycleTelemetry(batch, item);
        if (lifecycleRecords.length > 0) {
          for (const record of lifecycleRecords) {
            logger.emit({
              eventName: record.eventName,
              timestamp: new Date(record.timestamp),
              severityNumber: 9,
              body: record.body,
              attributes: record.attributes,
              context: parentContext,
            });
            eventCounter.add(1, {
              'repoctopus.event.type': record.eventName,
              'repoctopus.workflow.name': batch.run.workflowName,
            });
          }
          continue;
        }
        const observationSignals = observationSignalsByEvent.get(item.eventId);
        if (observationSignals) {
          for (const spanRecord of observationSignals.spans) {
            const span = observationTracer.startSpan(
              spanRecord.name,
              {
                startTime: new Date(spanRecord.startTime),
                attributes: spanRecord.attributes,
              },
              syntheticParentContext(batch.run.runId, spanRecord.traceId),
            );
            span.setStatus({
              code:
                spanRecord.result === 'failed' || spanRecord.result === 'rejected'
                  ? SpanStatusCode.ERROR
                  : SpanStatusCode.OK,
            });
            span.end(new Date(spanRecord.endTime));
          }
          for (const logRecord of observationSignals.logs) {
            observationLogger.emit({
              eventName: logRecord.eventName,
              timestamp: new Date(logRecord.observedAt),
              severityNumber: eventSeverity(item.type),
              body: logRecord.body,
              attributes: logRecord.attributes,
              context: observationContext(logRecord.traceId, logRecord.spanId),
            });
          }
          for (const metricRecord of observationSignals.metrics) {
            recordEncodedMetric(meter, observationMetricInstruments, metricRecord);
          }
          continue;
        }
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
        const executionMetric = executionMetricAttributes(item);
        if (executionMetric) {
          executionCounter.add(1, executionMetric);
          const startType = EXECUTION_SPAN_START[item.type];
          const startedBoundary = startType
            ? batch.trajectory.find(
                (candidate) =>
                  candidate.type === startType && sameExecutionBoundary(item, candidate),
              )
            : undefined;
          if (startType) {
            const startedAt = new Date(startedBoundary?.timestamp ?? item.timestamp);
            const endedAt = new Date(item.timestamp);
            const duration = Math.max(0, endedAt.getTime() - startedAt.getTime());
            attributes['repoctopus.execution.duration_ms'] = duration;
            const span = tracer.startSpan(
              executionSpanName(item.type),
              { startTime: startedAt, attributes },
              parentContext,
            );
            span.setStatus({
              code: item.data.result === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
            });
            span.end(endedAt);
            executionDuration.record(duration, executionMetric);
          }
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

async function exportStandaloneObservationSignals(
  signals: EncodedObservationSignals,
  serviceName: string,
  options: OpenTelemetryOptions,
): Promise<void> {
  if (signals.logs.length === 0) return;
  const timeoutMillis = options.timeoutMillis ?? 5_000;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: '0.1.0',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: options.environment ?? 'development',
    ...signals.logs[0]?.resourceAttributes,
  });
  let spanCursor = 0;
  const traceProvider = new BasicTracerProvider({
    resource,
    idGenerator: {
      generateTraceId: () => signals.logs[0]!.traceId,
      generateSpanId: () =>
        signals.spans[spanCursor++]?.spanId ??
        createHash('sha256')
          .update(`${serviceName}\0fallback\0${spanCursor}`)
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
  const instruments = metricInstrumentCache();
  try {
    for (const record of signals.spans) {
      const parent = observationContext(
        record.traceId,
        createHash('sha256')
          .update(`${serviceName}\0${record.traceId}\0root`)
          .digest('hex')
          .slice(0, 16),
      );
      const span = tracer.startSpan(
        record.name,
        { startTime: new Date(record.startTime), attributes: record.attributes },
        parent,
      );
      span.setStatus({
        code:
          record.result === 'failed' ||
          record.result === 'rejected' ||
          record.result === 'timed_out'
            ? SpanStatusCode.ERROR
            : SpanStatusCode.OK,
      });
      span.end(new Date(record.endTime));
    }
    for (const record of signals.logs) {
      logger.emit({
        eventName: record.eventName,
        timestamp: new Date(record.observedAt),
        severityNumber:
          record.attributes['repoctopus.lifecycle.result'] === 'failed' ||
          record.attributes['repoctopus.lifecycle.result'] === 'timed_out' ||
          record.attributes['repoctopus.delivery.result'] === 'failed'
            ? 13
            : 9,
        body: record.body,
        attributes: record.attributes,
        context: observationContext(record.traceId, record.spanId),
      });
    }
    for (const record of signals.metrics) {
      recordEncodedMetric(meter, instruments, record);
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

export class OpenTelemetryLifecycleExporter implements LifecycleTelemetryPort {
  constructor(private readonly options: OpenTelemetryOptions = {}) {}

  async export(events: readonly LifecycleTelemetryEvent[]): Promise<void> {
    const signals = encodeObservationEnvelopes(mapLifecycleObservationEnvelopes(events));
    await exportStandaloneObservationSignals(signals, 'repoctopus-lifecycle', this.options);
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
    const signals = encodeObservationEnvelopes([mapDeliveryObservationEnvelope(state, event)]);
    await exportStandaloneObservationSignals(signals, 'repoctopus-delivery', this.options);
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
