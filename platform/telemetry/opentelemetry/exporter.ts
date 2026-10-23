import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import type { DeliveryEvent, DeliveryTelemetryPort } from '../../../domains/delivery/ports.js';
import type { DeliveryState } from '../../../domains/delivery/types.js';
import { safeDeliveryAttributes } from '../delivery-mapping.js';
import type {
  LifecycleTelemetryEvent,
  LifecycleTelemetryPort,
} from '../../../services/lifecycle-diagnostics.js';

export interface OpenTelemetryOptions {
  timeoutMillis?: number;
  environment?: string;
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
