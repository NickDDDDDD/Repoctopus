import { describe, expect, it } from 'vitest';
import metadata from '../package.json' with { type: 'json' };

import { observationDestinationsFromEnvironment } from '../services/observation-telemetry.js';

describe('canonical observation destination configuration', () => {
  it('reports the product package version for remote and desktop while preserving service naming', () => {
    const destinations = observationDestinationsFromEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      REPOCTOPUS_DESKTOP_OTLP_ENDPOINT: 'http://127.0.0.1:4319',
      OTEL_SERVICE_NAME: 'team-runtime',
    });
    expect(destinations).toHaveLength(2);
    for (const destination of destinations) {
      expect(destination.resourceAttributes).toMatchObject({
        'service.name': 'team-runtime',
        'service.version': metadata.version,
      });
    }
  });

  it('uses the workspace base for signals with no environment endpoint', () => {
    const [remote] = observationDestinationsFromEnvironment(
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://trace.example/collect' },
      'https://workspace.example/otel/',
    );

    expect(remote?.signalEndpoints).toEqual({
      trace: 'https://trace.example/collect',
      log: 'https://workspace.example/otel/v1/logs',
      metric: 'https://workspace.example/otel/v1/metrics',
    });
  });

  it('preserves case-insensitive environment access when using the workspace base', () => {
    const environment = new Proxy<NodeJS.ProcessEnv>(
      {
        otel_exporter_otlp_traces_endpoint: 'https://trace.example/collect',
        otel_exporter_otlp_headers: 'authorization=Bearer%20example',
        otel_exporter_otlp_metrics_timeout: '9000',
      },
      {
        get(values, key) {
          return typeof key === 'string' ? values[key.toLowerCase()] : undefined;
        },
      },
    );
    const [remote] = observationDestinationsFromEnvironment(
      environment,
      'https://workspace.example',
    );

    expect(remote?.signalEndpoints?.trace).toBe('https://trace.example/collect');
    expect(remote?.signalHeaders?.metric?.authorization).toBe('Bearer example');
    expect(remote?.signalTimeouts?.metric).toBe(9_000);
  });

  it('prefers the common environment endpoint to the workspace base', () => {
    const [remote] = observationDestinationsFromEnvironment(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://deployment.example/otel' },
      'https://workspace.example/otel',
    );

    expect(remote?.signalEndpoints).toEqual({
      trace: 'https://deployment.example/otel/v1/traces',
      log: 'https://deployment.example/otel/v1/logs',
      metric: 'https://deployment.example/otel/v1/metrics',
    });
  });

  it('covers remote-only, remote-plus-desktop, desktop-disabled and signal-specific OTLP modes', () => {
    const [remoteOnly] = observationDestinationsFromEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    });
    expect(remoteOnly).toMatchObject({
      id: 'remote',
      endpoint: 'http://collector:4318',
      timeoutMillis: 5_000,
    });
    expect(remoteOnly?.resourceAttributes).toMatchObject({
      'service.name': 'repoctopus-runtime',
      'repoctopus.product.name': 'repoctopus',
    });

    expect(
      observationDestinationsFromEnvironment({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        REPOCTOPUS_DESKTOP_OTLP_ENDPOINT: 'http://127.0.0.1:4319',
        REPOCTOPUS_DESKTOP_OTLP_TOKEN: 'session-token',
      }),
    ).toEqual([
      expect.objectContaining({ id: 'remote', endpoint: 'http://collector:4318' }),
      expect.objectContaining({
        id: 'desktop',
        endpoint: 'http://127.0.0.1:4319',
        headers: { authorization: 'Bearer session-token' },
        timeoutMillis: 5_000,
      }),
    ]);

    expect(
      observationDestinationsFromEnvironment({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        REPOCTOPUS_DESKTOP_OTLP_ENDPOINT: '',
      }).map((item) => item.id),
    ).toEqual(['remote']);

    expect(
      observationDestinationsFromEnvironment({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/custom-traces',
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://collector:4318/custom-logs',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://collector:4318/custom-metrics',
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'remote',
        signalEndpoints: {
          trace: 'http://collector:4318/custom-traces',
          log: 'http://collector:4318/custom-logs',
          metric: 'http://collector:4318/custom-metrics',
        },
      }),
    ]);
  });

  it('applies signal-specific headers and timeouts without exposing secrets as resources', () => {
    const [remote] = observationDestinationsFromEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/otel',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20shared',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'x-signal=metrics',
      OTEL_EXPORTER_OTLP_TIMEOUT: '7000',
      OTEL_EXPORTER_OTLP_LOGS_TIMEOUT: '9000',
      OTEL_SERVICE_NAME: 'company-repoctopus',
      OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=developer-platform',
    });
    expect(remote).toMatchObject({
      id: 'remote',
      signalHeaders: {
        trace: { authorization: 'Bearer shared' },
        log: { authorization: 'Bearer shared' },
        metric: { 'x-signal': 'metrics' },
      },
      signalTimeouts: { trace: 7000, log: 9000, metric: 7000 },
      resourceAttributes: {
        'service.name': 'company-repoctopus',
        'service.namespace': 'developer-platform',
        'repoctopus.product.name': 'repoctopus',
      },
    });
    expect(JSON.stringify(remote?.resourceAttributes)).not.toMatch(/Bearer|collector/u);
  });
});
