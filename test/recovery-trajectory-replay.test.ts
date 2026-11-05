import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  classifyRecoveryObservation,
  type RecoveryObservation,
} from '../domains/runtime/recovery.js';

interface Fixture extends Omit<RecoveryObservation, 'schemaVersion' | 'runId' | 'expectedRevision' | 'checkEpoch' | 'observationId'> {
  name: string;
  expected: string | null;
}

const fixtures = JSON.parse(
  readFileSync(
    new URL('./fixtures/recovery/multi-repository-observations.json', import.meta.url),
    'utf8',
  ),
) as Fixture[];

describe('sanitized multi-repository recovery trajectory replay', () => {
  it.each(fixtures)('$name selects one highest-authority deterministic recovery', (fixture) => {
    const { name, expected, ...layers } = fixture;
    const observation = {
      schemaVersion: 1 as const,
      runId: 'sanitized-team-change',
      expectedRevision: 12,
      checkEpoch: 8,
      observationId: `fixture:${name}`,
      ...layers,
    };
    const first = classifyRecoveryObservation(observation);
    const replay = classifyRecoveryObservation(JSON.parse(JSON.stringify(observation)));
    expect(first?.action ?? null).toBe(expected);
    expect(replay).toEqual(first);
  });
});
