import { describe, expect, it, vi } from 'vitest';

import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import { createWorkExecutionSubmission } from '../domains/work-execution/submission.js';
import type {
  WorkExecutionCheckpoint,
  WorkExecutionHostOutcome,
} from '../domains/work-execution/types.js';
import { BuildWorkOutcomeAcceptanceCoordinator } from '../services/build-work-outcome-acceptance.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function harness(resultKind: 'execution-binding-candidate' | 'build-plan-candidate') {
  const work = {
    kind: 'build.configure',
    workId: 'build.configure:1',
    checkEpoch: 4,
    inputDigest: digest('1'),
    validatorProfile: { id: 'build.binding-valid' },
  } as WorkDescriptor;
  const outcome = {
    schemaVersion: 1,
    invocationId: digest('2'),
    hostId: 'host-1',
    packetDigest: digest('3'),
    status: 'succeeded',
    summary: 'candidate',
    consumedLayerDigests: [],
    result:
      resultKind === 'execution-binding-candidate'
        ? {
            schemaVersion: 1 as const,
            kind: resultKind,
            strategyDigest: digest('4'),
          }
        : { schemaVersion: 1 as const, kind: resultKind, packages: [] },
    completedAt: '2026-11-05T00:00:00.000Z',
  } satisfies WorkExecutionHostOutcome;
  const submission = createWorkExecutionSubmission('submission-1', outcome);
  const execution = {
    workId: work.workId,
    checkEpoch: work.checkEpoch,
    status: 'submitted',
    pendingSubmission: submission,
  } as WorkExecutionCheckpoint;
  const loadIntent = vi.fn().mockResolvedValue({ runId: 'run-1' });
  const rejectHostSubmission = vi.fn().mockResolvedValue(execution);
  const outcomeFactory = vi.fn().mockReturnValue({ outcomeId: 'outcome-1' });
  const acceptValidatedOutcome = vi.fn().mockResolvedValue({ validation: 'accepted' });
  const coordinator = new BuildWorkOutcomeAcceptanceCoordinator({
    workExecutionAuthority: { loadIntent, rejectHostSubmission } as never,
    workDispatcher: {
      outcome: outcomeFactory,
      acceptValidatedOutcome,
    } as never,
  });
  return {
    acceptValidatedOutcome,
    coordinator,
    execution,
    loadIntent,
    outcomeFactory,
    rejectHostSubmission,
    work,
  };
}

describe('Build Work Outcome acceptance coordinator', () => {
  it('keeps shape rejection before terminal binding', async () => {
    const fixture = harness('build-plan-candidate');
    const inspected = fixture.coordinator.inspect({
      work: fixture.work,
      execution: fixture.execution,
    });
    expect(inspected).toMatchObject({
      kind: 'correctable-rejection',
      reasonCode: 'output-invalid',
    });
    if (!inspected || inspected.kind === 'candidate' || inspected.kind === 'accepted') {
      throw new Error('Expected a correctable rejection');
    }
    await fixture.coordinator.reject('run-1', inspected);
    expect(fixture.rejectHostSubmission).toHaveBeenCalledOnce();
    expect(fixture.acceptValidatedOutcome).not.toHaveBeenCalled();
  });

  it('binds one validated candidate through the guarded acceptance entry', async () => {
    const fixture = harness('execution-binding-candidate');
    const inspected = fixture.coordinator.inspect({
      work: fixture.work,
      execution: fixture.execution,
    });
    if (!inspected || inspected.kind !== 'candidate') throw new Error('Expected candidate');

    await fixture.coordinator.accept({
      runId: 'run-1',
      candidate: inspected,
      validatorId: 'build.binding-valid',
    });

    expect(fixture.acceptValidatedOutcome).toHaveBeenCalledWith({
      outcome: { outcomeId: 'outcome-1' },
      validation: expect.objectContaining({
        workKind: 'build.configure',
        submissionId: 'submission-1',
        stableInputDigest: fixture.work.inputDigest,
      }),
    });
    expect(fixture.rejectHostSubmission).not.toHaveBeenCalled();
  });
});
