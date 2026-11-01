import { describe, expect, it } from 'vitest';

import { METRIC_COVERAGE } from '../domains/telemetry/observation-contract.js';

describe('recommended telemetry metric coverage', () => {
  it('classifies the exact 22-item input without turning unavailable evidence into zero', () => {
    expect(METRIC_COVERAGE).toHaveLength(22);
    expect(new Set(METRIC_COVERAGE.map((item) => item.id)).size).toBe(22);
    expect(METRIC_COVERAGE.filter((item) => item.status !== 'out-of-scope')).toHaveLength(9);
    expect(METRIC_COVERAGE.filter((item) => item.status === 'out-of-scope')).toHaveLength(13);
    for (const item of METRIC_COVERAGE) {
      expect(item.missingSemantics).toBe('unknown');
      expect(item.authoritativeSource).not.toBe('');
      if (item.status === 'out-of-scope') {
        expect(item.formula).toBeNull();
        expect(item.externalDependency).not.toBeNull();
      } else {
        expect(item.formula).not.toBeNull();
      }
    }
  });
});
