import { describe, expect, it } from 'vitest';

import {
  classifyRecoveryObservation,
  parseRecoveryObservation,
  type RecoveryObservation,
} from '../domains/runtime/recovery.js';

function observation(overrides: Partial<RecoveryObservation> = {}): RecoveryObservation {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    expectedRevision: 7,
    checkEpoch: 3,
    observationId: 'observation-1',
    planning: { status: 'current', changedIdentities: [] },
    plan: { status: 'current', changedIdentities: [] },
    work: { status: 'current', changedIdentities: [] },
    evidence: { status: 'current', changedIdentities: [] },
    ...overrides,
  };
}

describe('Runtime recovery decision', () => {
  it.each([
    {
      name: 'planning drift revises design',
      input: observation({
        planning: {
          status: 'drift',
          reasonCode: 'requirements-changed',
          changedIdentities: ['planning-semantic'],
        },
      }),
      action: 'revise-design',
      authority: 'planning',
    },
    {
      name: 'plan drift revises only the plan',
      input: observation({
        plan: {
          status: 'drift',
          reasonCode: 'package-not-completable',
          changedIdentities: ['build-plan'],
        },
      }),
      action: 'revise-plan',
      authority: 'plan',
    },
    {
      name: 'retryable work continues the current build',
      input: observation({
        work: {
          status: 'retryable',
          reasonCode: 'implementation-failed',
          changedIdentities: [],
        },
      }),
      action: 'continue-build',
      authority: 'work',
    },
    {
      name: 'evidence drift invalidates only evidence dependents',
      input: observation({
        evidence: {
          status: 'drift',
          reasonCode: 'declared-input-changed',
          changedIdentities: ['verification-input'],
        },
      }),
      action: 'invalidate-evidence',
      authority: 'evidence',
    },
  ])('$name', ({ input, action, authority }) => {
    expect(classifyRecoveryObservation(input)).toMatchObject({
      action,
      authority,
      expectedRevision: 7,
      checkEpoch: 3,
      observationId: 'observation-1',
    });
  });

  it('selects the highest invalid authority once', () => {
    const decision = classifyRecoveryObservation(
      observation({
        planning: {
          status: 'drift',
          reasonCode: 'design-changed',
          changedIdentities: ['planning-semantic'],
        },
        plan: {
          status: 'drift',
          reasonCode: 'package-not-completable',
          changedIdentities: ['build-plan'],
        },
        evidence: {
          status: 'drift',
          reasonCode: 'declared-input-changed',
          changedIdentities: ['verification-input'],
        },
      }),
    );

    expect(decision).toMatchObject({ action: 'revise-design', authority: 'planning' });
    expect(decision?.invalidatedIdentities).toContain('build-plan');
  });

  it('derives the same decision identity from equivalent unordered identity facts', () => {
    const left = classifyRecoveryObservation(
      observation({
        planning: {
          status: 'drift',
          reasonCode: 'design-changed',
          changedIdentities: ['approval-authority', 'planning-semantic'],
        },
      }),
    );
    const right = classifyRecoveryObservation(
      observation({
        planning: {
          status: 'drift',
          reasonCode: 'design-changed',
          changedIdentities: ['planning-semantic', 'approval-authority'],
        },
      }),
    );

    expect(left?.decisionId).toMatch(/^recovery:sha256:[a-f0-9]{64}$/u);
    expect(right?.decisionId).toBe(left?.decisionId);
  });

  it('rejects a Host-selected phase or recovery action', () => {
    const valid = observation();

    expect(() => parseRecoveryObservation({ ...valid, targetPhase: 'design' })).toThrow(
      /cannot select.*phase/iu,
    );
    expect(() => parseRecoveryObservation({ ...valid, recoveryAction: 'revise-design' })).toThrow(
      /cannot select.*recovery action/iu,
    );
  });
});
