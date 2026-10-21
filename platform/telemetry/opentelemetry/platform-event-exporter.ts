import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import type {
  PlatformEventTelemetryEvent,
  PlatformEventTelemetryPort,
} from '../../../domains/platform-events/ports.js';
import { safePlatformEventAttributes } from '../platform-event-mapping.js';

export interface PlatformEventOpenTelemetryOptions {
  environment?: string;
  timeoutMillis?: number;
}

export class OpenTelemetryPlatformEventExporter implements PlatformEventTelemetryPort {
  constructor(private readonly options: PlatformEventOpenTelemetryOptions = {}) {}

  async export(event: PlatformEventTelemetryEvent): Promise<void> {
    const timeoutMillis = this.options.timeoutMillis ?? 5_000;
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'repoctopus-platform-events',
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
      const attributes = safePlatformEventAttributes(event);
      loggerProvider.getLogger('repoctopus-platform-events', '0.1.0').emit({
        eventName: `repoctopus.${event.type}`,
        timestamp: new Date(event.timestamp),
        severityNumber: 9,
        body: `Repoctopus platform event: ${event.type}`,
        attributes,
      });
      meterProvider
        .getMeter('repoctopus-platform-events', '0.1.0')
        .createCounter('repoctopus.platform_event.events', { unit: '{event}' })
        .add(1, {
          'repoctopus.platform_event.event.type': event.type,
          'repoctopus.platform_event.provider': event.provider,
          'repoctopus.platform_event.type': event.eventType,
          'repoctopus.platform_event.status': event.status,
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

export function platformEventTelemetryFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): PlatformEventTelemetryPort {
  const endpoint =
    environment.OTEL_EXPORTER_OTLP_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (!endpoint) return { async export() {} };
  const options: PlatformEventOpenTelemetryOptions = {};
  if (!environment.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment.name=')) {
    options.environment = environment.REPOCTOPUS_ENVIRONMENT ?? 'development';
  }
  return new OpenTelemetryPlatformEventExporter(options);
}
