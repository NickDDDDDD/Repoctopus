import { describe, expect, it } from 'vitest';

import { isLifecycleEvidenceOnlyChange } from '../scripts/managed-execution-report-boundary.mjs';

describe('managed execution report boundary', () => {
  it.each([
    'openspec/specs/development-telemetry/spec.md',
    'verification/change/verification-report.md',
    'docs/superpowers/plans/change.md',
    'scripts/check-managed-execution-report.mjs',
    'scripts/managed-execution-report-boundary.d.mts',
    'scripts/managed-execution-report-boundary.mjs',
    'test/managed-execution-report-boundary.test.ts',
  ])('treats %s as lifecycle evidence rather than packaged product code', (file) => {
    expect(isLifecycleEvidenceOnlyChange(file)).toBe(true);
  });

  it.each([
    'domains/telemetry/observation-contract.ts',
    'docs/telemetry.md',
    'package.json',
    'scripts/build.mjs',
    'test/telemetry-mapping.test.ts',
  ])('keeps %s inside the packaged product verification boundary', (file) => {
    expect(isLifecycleEvidenceOnlyChange(file)).toBe(false);
  });
});
