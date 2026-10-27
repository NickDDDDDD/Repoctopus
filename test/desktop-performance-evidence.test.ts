import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

interface PerformanceEvidence {
  schemaVersion: number;
  kind: string;
  status: string;
  taskId: string;
  measurements: Record<
    string,
    {
      value: number;
      unit: string;
      budget: number;
      comparison: 'at-most' | 'at-least';
      passed: boolean;
    }
  >;
}

describe('Windows Desktop performance Evidence', () => {
  it('records a passing fixed-method measurement for all five resource budgets', async () => {
    const evidence = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          'verification',
          'add-windows-desktop-dashboard',
          'desktop-performance.json',
        ),
        'utf8',
      ),
    ) as PerformanceEvidence;

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      kind: 'WindowsDesktopPerformance',
      taskId: '7.4',
      status: 'passed',
    });
    expect(Object.keys(evidence.measurements).sort()).toEqual([
      'activeWorkingSetBytes',
      'coldStartMs',
      'idleWorkingSetBytes',
      'installerBytes',
      'receiverRequestsPerSecond',
    ]);
    for (const measurement of Object.values(evidence.measurements)) {
      expect(measurement.value).toBeGreaterThan(0);
      expect(measurement.budget).toBeGreaterThan(0);
      expect(measurement.passed).toBe(true);
    }
  });
});
