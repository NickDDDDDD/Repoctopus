import { describe, expect, it } from 'vitest';

import {
  createRepoctopusResource,
  resolveOtlpDeployment,
} from '../platform/telemetry/opentelemetry/config.js';

describe('OpenTelemetry deployment configuration', () => {
  it('resolves unified and signal-specific OTLP HTTP endpoints with standard headers', () => {
    const config = resolveOtlpDeployment({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/otel/',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://traces.example/custom',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20opaque,x-tenant=platform',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'x-signal=metrics',
      OTEL_EXPORTER_OTLP_TIMEOUT: '7000',
      OTEL_EXPORTER_OTLP_LOGS_TIMEOUT: '9000',
    });

    expect(config.traces).toMatchObject({
      enabled: true,
      url: 'https://traces.example/custom',
      headers: { authorization: 'Bearer opaque', 'x-tenant': 'platform' },
      timeoutMillis: 7000,
    });
    expect(config.logs).toMatchObject({
      enabled: true,
      url: 'https://collector.example/otel/v1/logs',
      timeoutMillis: 9000,
    });
    expect(config.metrics).toMatchObject({
      enabled: true,
      url: 'https://collector.example/otel/v1/metrics',
      headers: { 'x-signal': 'metrics' },
      timeoutMillis: 7000,
    });
  });

  it('keeps absent signals disabled when only one signal endpoint is configured', () => {
    const config = resolveOtlpDeployment({
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:4318/logs',
    });
    expect(config.traces.enabled).toBe(false);
    expect(config.logs).toMatchObject({ enabled: true, url: 'http://127.0.0.1:4318/logs' });
    expect(config.metrics.enabled).toBe(false);
  });

  it('merges resource attributes deterministically and never exposes headers or endpoints', () => {
    const resource = createRepoctopusResource('repoctopus-runtime', '0.1.0', {
      OTEL_RESOURCE_ATTRIBUTES:
        'deployment.environment.name=staging,service.namespace=developer-platform,repoctopus.product.name=spoofed',
      OTEL_SERVICE_NAME: 'company-repoctopus',
      REPOCTOPUS_ENVIRONMENT: 'legacy-development',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=secret',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example',
    });
    expect(resource.attributes).toMatchObject({
      'service.name': 'company-repoctopus',
      'service.version': '0.1.0',
      'service.namespace': 'developer-platform',
      'deployment.environment.name': 'staging',
      'repoctopus.product.name': 'repoctopus',
      'repoctopus.telemetry.schema': '1',
    });
    expect(JSON.stringify(resource.attributes)).not.toMatch(/secret|collector\.example/u);
  });

  it('uses the compatibility environment only when the standard resource attribute is absent', () => {
    const resource = createRepoctopusResource('repoctopus-evidence', '0.1.0', {
      REPOCTOPUS_ENVIRONMENT: 'integration',
    });
    expect(resource.attributes['deployment.environment.name']).toBe('integration');
    expect(resolveOtlpDeployment({}).enabled).toBe(false);
  });
});
