import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace, type Context } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createHash } from 'node:crypto';

import type { TelemetryBatch, TelemetryPort } from '../../../domains/runtime/types.js';
import {
  projectRuleMeasurements,
  projectSkillMeasurements,
  projectWorkflowMeasurements,
} from '../../../domains/telemetry/measurements.js';
import type { DeliveryEvent, DeliveryTelemetryPort } from '../../../domains/delivery/ports.js';
import type { DeliveryState } from '../../../domains/delivery/types.js';
import { safeDeliveryAttributes } from '../delivery-mapping.js';
import { acceptedChangeLifecycleTelemetry } from '../change-lifecycle-mapping.js';
import {
  eventSeverity,
  executionMetricAttributes,
  safeEventAttributes,
  workflowEventMetricAttributes,
  workflowStepMetricAttributes,
} from './mapping.js';
import type {
  LifecycleTelemetryEvent,
  LifecycleTelemetryPort,
} from '../../../services/lifecycle-diagnostics.js';
import { createRepoctopusResource, resolveOtlpDeployment } from './config.js';

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

const EXECUTION_SPAN_START: Partial<
  Record<TelemetryBatch['events'][number]['type'], TelemetryBatch['events'][number]['type']>
> = {
  'work.completed': 'work.claimed',
  'work.host-completed': 'work.host-started',
  'tool.completed': 'tool.started',
  'wait.ended': 'wait.started',
  'reconcile.completed': 'reconcile.started',
};

function sameExecutionBoundary(
  left: TelemetryBatch['events'][number],
  right: TelemetryBatch['events'][number],
): boolean {
  for (const key of ['invocationId', 'operationId', 'waitId', 'reconcileId'] as const) {
    const value = left.data[key];
    if (typeof value === 'string') return value === right.data[key];
  }
  return left.data.workId === right.data.workId && left.data.attempt === right.data.attempt;
}

function executionSpanName(type: TelemetryBatch['events'][number]['type']): string {
  if (type.startsWith('work.host-')) return 'repoctopus.host';
  if (type.startsWith('work.')) return 'repoctopus.work';
  if (type.startsWith('tool.')) return 'repoctopus.tool';
  if (type.startsWith('validator.')) return 'repoctopus.validator';
  if (type.startsWith('wait.')) return 'repoctopus.wait';
  if (type.startsWith('reconcile.')) return 'repoctopus.reconcile';
  return 'repoctopus.execution';
}

export interface OpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
  processEnvironment?: NodeJS.ProcessEnv;
}

function deploymentEnvironment(options: OpenTelemetryOptions): NodeJS.ProcessEnv {
  const environment = { ...(options.processEnvironment ?? process.env) };
  if (
    options.environment &&
    !environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')
  ) {
    environment.REPOCTOPUS_ENVIRONMENT = options.environment;
  }
  return environment;
}

export class OpenTelemetryExporter implements TelemetryPort {
  constructor(private readonly options: OpenTelemetryOptions = {}) {}

  async export(batch: TelemetryBatch): Promise<void> {
    const environment = deploymentEnvironment(this.options);
    const deployment = resolveOtlpDeployment(environment);
    if (!deployment.enabled) return;
    const resource = createRepoctopusResource('repoctopus-runtime', '0.1.0', environment);
    const exportsRoot = batch.events.some((event) => event.type === 'run.started');
    const spannedEvents = batch.events.filter(
      (event) =>
        event.type === 'action.completed' ||
        EXECUTION_SPAN_START[event.type] !== undefined ||
        event.type === 'validator.completed',
    );
    const stableSpanIds = [
      ...(exportsRoot ? [rootSpanId(batch.run.runId)] : []),
      ...spannedEvents.map((event) =>
        createHash('sha256')
          .update(`${batch.run.runId}\0${event.eventId}\0${event.type}`)
          .digest('hex')
          .slice(0, 16),
      ),
    ];
    let spanCursor = 0;
    const traceTimeout = this.options.timeoutMillis ?? deployment.traces.timeoutMillis;
    const logTimeout = this.options.timeoutMillis ?? deployment.logs.timeoutMillis;
    const metricTimeout = this.options.timeoutMillis ?? deployment.metrics.timeoutMillis;
    const traceProvider = deployment.traces.enabled
      ? new BasicTracerProvider({
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

    const tracer = traceProvider?.getTracer('repoctopus-runtime', '0.1.0');
    const logger = loggerProvider?.getLogger('repoctopus-runtime', '0.1.0');
    const meter = meterProvider?.getMeter('repoctopus-runtime', '0.1.0');
    const eventCounter = meter?.createCounter('repoctopus.workflow.events', {
      description: 'Number of Repoctopus workflow events exported',
      unit: '{event}',
    });
    const stepDuration = meter?.createHistogram('repoctopus.workflow.step.duration', {
      description: 'Completed Repoctopus workflow step duration',
      unit: 'ms',
    });
    const executionCounter = meter?.createCounter('repoctopus.work.execution.events', {
      description: 'Committed managed Work execution events',
      unit: '{event}',
    });
    const executionDuration = meter?.createHistogram('repoctopus.work.execution.duration', {
      description: 'Managed Work, Host, tool, Validator, wait, and reconcile duration',
      unit: 'ms',
    });
    const skillUsage = meter?.createCounter('repoctopus.skill.usage', {
      description: 'Consumed Skills and correlated Work outcomes',
      unit: '{event}',
    });
    const ruleEvaluation = meter?.createCounter('repoctopus.rule.evaluation', {
      description: 'Machine-verifiable Rule evaluation facts',
      unit: '{event}',
    });
    const workflowRun = meter?.createCounter('repoctopus.workflow.run', {
      description: 'Logical workflow Run lifecycle facts',
      unit: '{run}',
    });
    const workflowRunDuration = meter?.createHistogram('repoctopus.workflow.run.duration', {
      description: 'Authoritative terminal workflow Run duration',
      unit: 'ms',
    });
    const parentContext = syntheticParentContext(batch.run.runId, batch.run.traceId);

    try {
      const started = batch.events.find((event) => event.type === 'run.started');
      if (started && tracer) {
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
        const lifecycleRecords = acceptedChangeLifecycleTelemetry(batch, item);
        if (lifecycleRecords.length > 0) {
          for (const record of lifecycleRecords) {
            logger?.emit({
              eventName: record.eventName,
              timestamp: new Date(record.timestamp),
              severityNumber: 9,
              body: record.body,
              attributes: record.attributes,
              context: parentContext,
            });
            eventCounter?.add(1, {
              'repoctopus.event.type': record.eventName,
              'repoctopus.workflow.name': batch.run.workflowName,
            });
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
          const span = tracer?.startSpan(
            'repoctopus.step',
            { startTime: startedAt, attributes },
            parentContext,
          );
          span?.setStatus({
            code: item.data.result === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          });
          span?.end(endedAt);
          stepDuration?.record(duration, workflowStepMetricAttributes(batch, item));
        }
        const executionMetric = executionMetricAttributes(item);
        if (executionMetric) {
          executionCounter?.add(1, executionMetric);
          const startType = EXECUTION_SPAN_START[item.type];
          const startedBoundary = startType
            ? batch.trajectory.find(
                (candidate) =>
                  candidate.type === startType && sameExecutionBoundary(item, candidate),
              )
            : undefined;
          if (startType || item.type === 'validator.completed') {
            const startedAt = new Date(startedBoundary?.timestamp ?? item.timestamp);
            const endedAt = new Date(item.timestamp);
            const duration = Math.max(0, endedAt.getTime() - startedAt.getTime());
            attributes['repoctopus.execution.duration_ms'] = duration;
            const span = tracer?.startSpan(
              executionSpanName(item.type),
              { startTime: startedAt, attributes },
              parentContext,
            );
            span?.setStatus({
              code: item.data.result === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
            });
            span?.end(endedAt);
            executionDuration?.record(duration, executionMetric);
          }
        }

        logger?.emit({
          eventName: `repoctopus.${item.type}`,
          timestamp: new Date(item.timestamp),
          severityNumber: eventSeverity(item.type),
          body: `Repoctopus workflow event: ${item.type}`,
          attributes,
          context: parentContext,
        });
        eventCounter?.add(1, workflowEventMetricAttributes(batch, item));
      }
      for (const measurement of projectSkillMeasurements(batch)) {
        logger?.emit({
          eventName: 'repoctopus.measurement.skill',
          timestamp: new Date(measurement.timestamp),
          severityNumber: measurement.result === 'error' ? 13 : 9,
          body: 'Repoctopus Skill measurement fact',
          attributes: {
            'repoctopus.measurement.id': measurement.measurementId,
            'repoctopus.event.id': measurement.sourceEventId,
            'repoctopus.run.id': measurement.runId,
            'repoctopus.execution.workId': measurement.workId,
            'repoctopus.execution.attempt': measurement.attempt,
            'repoctopus.execution.invocationId': measurement.invocationId,
            'repoctopus.skill.id': measurement.skillId,
            'repoctopus.skill.role': measurement.role,
            'repoctopus.skill.category': measurement.category,
            'repoctopus.skill.result': measurement.result,
          },
          context: parentContext,
        });
        skillUsage?.add(1, {
          'repoctopus.skill.role': measurement.role,
          'repoctopus.skill.category': measurement.category,
          'repoctopus.skill.result': measurement.result,
        });
      }
      for (const measurement of projectRuleMeasurements(batch)) {
        logger?.emit({
          eventName: 'repoctopus.measurement.rule',
          timestamp: new Date(measurement.timestamp),
          severityNumber: measurement.result === 'violated' ? 13 : 9,
          body: 'Repoctopus Rule evaluation fact',
          attributes: {
            'repoctopus.measurement.id': measurement.measurementId,
            'repoctopus.event.id': measurement.sourceEventId,
            'repoctopus.run.id': measurement.runId,
            'repoctopus.execution.workId': measurement.workId,
            'repoctopus.rule.id': measurement.ruleId,
            'repoctopus.rule.digest': measurement.ruleDigest,
            'repoctopus.rule.evaluator.id': measurement.evaluatorId,
            'repoctopus.rule.evaluator.version': measurement.evaluatorVersion,
            'repoctopus.rule.category': measurement.category,
            'repoctopus.rule.result': measurement.result,
          },
          context: parentContext,
        });
        ruleEvaluation?.add(1, {
          'repoctopus.rule.category': measurement.category,
          'repoctopus.rule.result': measurement.result,
        });
      }
      for (const measurement of projectWorkflowMeasurements(batch)) {
        const metricAttributes = {
          'repoctopus.workflow.name': measurement.workflowName,
          'repoctopus.workflow.version': measurement.workflowVersion,
          'repoctopus.workflow.run.result': measurement.result,
        } as const;
        logger?.emit({
          eventName: 'repoctopus.measurement.workflow',
          timestamp: new Date(measurement.timestamp),
          severityNumber: measurement.result === 'failed' ? 13 : 9,
          body: 'Repoctopus workflow Run measurement fact',
          attributes: {
            'repoctopus.measurement.id': measurement.measurementId,
            'repoctopus.event.id': measurement.sourceEventId,
            'repoctopus.run.id': measurement.runId,
            ...metricAttributes,
            ...(measurement.durationMs === null
              ? {}
              : { 'repoctopus.workflow.run.duration_ms': measurement.durationMs }),
          },
          context: parentContext,
        });
        workflowRun?.add(1, metricAttributes);
        if (measurement.durationMs !== null) {
          workflowRunDuration?.record(measurement.durationMs, metricAttributes);
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
    const environment = deploymentEnvironment(this.options);
    const deployment = resolveOtlpDeployment(environment);
    if (!deployment.logs.enabled && !deployment.metrics.enabled) return;
    const resource = createRepoctopusResource('repoctopus-lifecycle', '0.1.0', environment);
    const logTimeout = this.options.timeoutMillis ?? deployment.logs.timeoutMillis;
    const metricTimeout = this.options.timeoutMillis ?? deployment.metrics.timeoutMillis;
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
    const logger = loggerProvider?.getLogger('repoctopus-lifecycle', '0.1.0');
    const counter = meterProvider
      ?.getMeter('repoctopus-lifecycle', '0.1.0')
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
        logger?.emit({
          eventName: `repoctopus.${event.type}`,
          timestamp: new Date(event.timestamp),
          severityNumber: event.result === 'failed' || event.result === 'timed_out' ? 13 : 9,
          body: `Repoctopus lifecycle event: ${event.type}`,
          attributes,
        });
        counter?.add(1, {
          'repoctopus.lifecycle.type': event.type,
          'repoctopus.lifecycle.phase': event.phase,
          'repoctopus.lifecycle.result': event.result,
        });
      }
      await Promise.all([
        ...(loggerProvider ? [loggerProvider.forceFlush({ timeoutMillis: logTimeout })] : []),
        ...(meterProvider ? [meterProvider.forceFlush({ timeoutMillis: metricTimeout })] : []),
      ]);
    } finally {
      await Promise.allSettled([
        ...(loggerProvider ? [loggerProvider.shutdown()] : []),
        ...(meterProvider ? [meterProvider.shutdown()] : []),
      ]);
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
    const environment = deploymentEnvironment(this.options);
    const deployment = resolveOtlpDeployment(environment);
    if (!deployment.logs.enabled && !deployment.metrics.enabled) return;
    const resource = createRepoctopusResource('repoctopus-delivery', '0.1.0', environment);
    const logTimeout = this.options.timeoutMillis ?? deployment.logs.timeoutMillis;
    const metricTimeout = this.options.timeoutMillis ?? deployment.metrics.timeoutMillis;
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
    try {
      const attributes = safeDeliveryAttributes(state, event);
      loggerProvider?.getLogger('repoctopus-delivery', '0.1.0').emit({
        eventName: `repoctopus.${event.type}`,
        timestamp: new Date(event.timestamp),
        severityNumber: 9,
        body: `Repoctopus delivery event: ${event.type}`,
        attributes,
      });
      meterProvider
        ?.getMeter('repoctopus-delivery', '0.1.0')
        .createCounter('repoctopus.delivery.events', { unit: '{event}' })
        .add(1, {
          'repoctopus.delivery.event.type': event.type,
          'repoctopus.delivery.state': state.status,
        });
      await Promise.all([
        ...(loggerProvider ? [loggerProvider.forceFlush({ timeoutMillis: logTimeout })] : []),
        ...(meterProvider ? [meterProvider.forceFlush({ timeoutMillis: metricTimeout })] : []),
      ]);
    } finally {
      await Promise.allSettled([
        ...(loggerProvider ? [loggerProvider.shutdown()] : []),
        ...(meterProvider ? [meterProvider.shutdown()] : []),
      ]);
    }
  }
}

export function telemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TelemetryPort {
  if (!resolveOtlpDeployment(environment).enabled) {
    return { async export() {} };
  }
  return new OpenTelemetryExporter({ processEnvironment: environment });
}

export function deliveryTelemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DeliveryTelemetryPort {
  const deployment = resolveOtlpDeployment(environment);
  if (!deployment.logs.enabled && !deployment.metrics.enabled) return { async export() {} };
  return new OpenTelemetryDeliveryExporter({ processEnvironment: environment });
}

export function lifecycleTelemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): LifecycleTelemetryPort {
  const deployment = resolveOtlpDeployment(environment);
  if (!deployment.logs.enabled && !deployment.metrics.enabled) return { async export() {} };
  return new OpenTelemetryLifecycleExporter({ processEnvironment: environment });
}
