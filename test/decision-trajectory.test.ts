import { describe, expect, it } from 'vitest';

import {
  decisionKindForWaitId,
  decisionPhase,
  observationWaitKind,
} from '../domains/telemetry/decision-trajectory.js';

describe('Decision trajectory vocabulary', () => {
  it.each([
    ['open-approval:request-1', 'open-approval', 'open'],
    ['design-approval:request-2', 'design-approval', 'design'],
    ['build-adoption:request-3', 'adopt-existing', 'build'],
    ['build-design:request-4', 'design-revision', 'build'],
  ] as const)('maps %s to its stable Decision kind and origin phase', (waitId, kind, phase) => {
    expect(decisionKindForWaitId(waitId)).toBe(kind);
    expect(decisionPhase(kind)).toBe(phase);
  });

  it('normalizes lifecycle Wait kinds to bounded observation dimensions', () => {
    expect(observationWaitKind('human-decision')).toBe('human');
    expect(observationWaitKind('retry')).toBe('retry');
    expect(observationWaitKind('external-fact')).toBe('external-fact');
  });
});
