import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  METRIC_COVERAGE,
  TELEMETRY_ATTRIBUTES,
  TELEMETRY_SIGNALS,
} from '../domains/telemetry/observation-contract.js';

describe('telemetry documentation', () => {
  it('contains every public signal, attribute, and recommended metric identity', async () => {
    const reference = await readFile(
      new URL('../docs/telemetry-reference.md', import.meta.url),
      'utf8',
    );
    for (const item of TELEMETRY_SIGNALS) expect(reference).toContain(`\`${item.name}\``);
    for (const item of TELEMETRY_ATTRIBUTES) expect(reference).toContain(`\`${item.name}\``);
    for (const item of METRIC_COVERAGE) expect(reference).toContain(`\`${item.id}\``);
  });

  it('documents standard deployment fields without defining aliases or transforms', async () => {
    const guide = await readFile(new URL('../docs/telemetry.md', import.meta.url), 'utf8');
    for (const name of [
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'OTEL_EXPORTER_OTLP_TIMEOUT',
      'OTEL_SERVICE_NAME',
      'OTEL_RESOURCE_ATTRIBUTES',
    ]) {
      expect(guide).toContain(name);
    }
    expect(guide).toContain('不提供字段别名');
    expect(guide).toContain('Collector Transform');
  });
});
