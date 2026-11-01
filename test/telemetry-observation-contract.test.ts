import { describe, expect, it } from 'vitest';

import {
  METRIC_COVERAGE,
  TELEMETRY_ATTRIBUTES,
  TELEMETRY_SIGNALS,
  validateObservationContract,
} from '../domains/telemetry/observation-contract.js';

describe('telemetry observation contract', () => {
  it('publishes one internally consistent schema v1 catalog', () => {
    expect(validateObservationContract()).toEqual([]);
    expect(new Set(TELEMETRY_SIGNALS.map((item) => `${item.kind}:${item.name}`)).size).toBe(
      TELEMETRY_SIGNALS.length,
    );
    expect(new Set(TELEMETRY_ATTRIBUTES.map((item) => item.name)).size).toBe(
      TELEMETRY_ATTRIBUTES.length,
    );
    const metrics = new Set(
      TELEMETRY_SIGNALS.filter((item) => item.kind === 'metric').map((item) => item.name),
    );
    expect(metrics).toEqual(
      new Set([
        'repoctopus.observation',
        'repoctopus.workflow.events',
        'repoctopus.workflow.step.duration',
        'repoctopus.work.execution.events',
        'repoctopus.work.execution.duration',
        'repoctopus.evidence.events',
        'repoctopus.evidence.node.duration',
        'repoctopus.lifecycle.events',
        'repoctopus.delivery.events',
        'repoctopus.skill.usage',
        'repoctopus.rule.evaluation',
        'repoctopus.workflow.run',
        'repoctopus.workflow.run.duration',
      ]),
    );
    expect(
      TELEMETRY_ATTRIBUTES.find((item) => item.name === 'repoctopus.skill.correction.kind')?.values,
    ).toEqual(['changes-requested', 'outcome-rejection', 'task-reopen', 'repair-work']);
  });

  it('classifies all 22 recommended metrics without manufacturing unavailable facts', () => {
    expect(METRIC_COVERAGE).toHaveLength(22);
    expect(new Set(METRIC_COVERAGE.map((item) => item.id)).size).toBe(22);
    expect(METRIC_COVERAGE.filter((item) => item.status !== 'out-of-scope')).toHaveLength(9);
    expect(METRIC_COVERAGE.filter((item) => item.status === 'out-of-scope')).toHaveLength(13);
    for (const item of METRIC_COVERAGE) {
      expect(item.authoritativeSource.length).toBeGreaterThan(0);
      expect(item.missingSemantics).toBe('unknown');
      if (item.status === 'out-of-scope') expect(item.formula).toBeNull();
      else expect(item.formula).not.toBeNull();
    }
  });
});
