import { describe, expect, it } from 'vitest';

import { observationDestinationsFromEnvironment } from '../services/observation-telemetry.js';

describe('canonical observation destination configuration', () => {
  it('covers remote-only, remote-plus-desktop, desktop-disabled and signal-specific OTLP modes', () => {
    expect(
      observationDestinationsFromEnvironment({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
      }),
    ).toEqual([{ id: 'remote', endpoint: 'http://collector:4318' }]);

    expect(
      observationDestinationsFromEnvironment({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        REPOCTOPUS_DESKTOP_OTLP_ENDPOINT: 'http://127.0.0.1:4319',
        REPOCTOPUS_DESKTOP_OTLP_TOKEN: 'session-token',
      }),
    ).toEqual([
      { id: 'remote', endpoint: 'http://collector:4318' },
      {
        id: 'desktop',
        endpoint: 'http://127.0.0.1:4319',
        headers: { authorization: 'Bearer session-token' },
      },
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
      {
        id: 'remote',
        signalEndpoints: {
          trace: 'http://collector:4318/custom-traces',
          log: 'http://collector:4318/custom-logs',
          metric: 'http://collector:4318/custom-metrics',
        },
      },
    ]);
  });
});
