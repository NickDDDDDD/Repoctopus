import { describe, expect, it, vi } from 'vitest';

import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import { createWorkExecutionSubmission } from '../domains/work-execution/submission.js';
import type {
  WorkExecutionCheckpoint,
  WorkExecutionHostOutcome,
} from '../domains/work-execution/types.js';
import { BuildWorkOutcomeAcceptanceCoordinator } from '../services/build-work-outcome-acceptance.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

const candidates = {
  'build.configure': {
    schemaVersion: 1 as const,
    kind: 'execution-binding-candidate' as const,
    strategyDigest: digest('4'),
  },
  'build.plan': {
    schemaVersion: 1 as const,
    kind: 'build-plan-candidate' as const,
    packages: [],
  },
  'build.execute': {
    schemaVersion: 1 as const,
    kind: 'build-package-completion' as const,
    packageId: 'package-1',
    acceptanceEvidenceIds: ['acceptance-1'],
    testEvidenceIds: ['test-1'],
    implementationDigest: digest('5'),
  },
  'build.check': {
    schemaVersion: 1 as const,
    kind: 'build-check-candidate' as const,
    completedPackageIds: ['package-1'],
    acceptedTaskIds: ['task-1'],
    testEvidenceIds: ['test-1'],
    implementationDigest: digest('5'),
    reviewerExecutionId: 'reviewer-1',
  },
};

type BuildWorkKind = keyof typeof candidates;

const invalidCandidates = {
  'build.configure': candidates['build.plan'],
  'build.plan': candidates['build.execute'],
  'build.execute': candidates['build.check'],
  'build.check': candidates['build.configure'],
};

function harness(workKind: BuildWorkKind, validShape = true) {
  const work = {
    kind: workKind,
    workId: `${workKind}:1`,
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
    result: validShape ? candidates[workKind] : invalidCandidates[workKind],
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
    workExecutionAuthority: { loadIntent, rejectHostSubmission },
    workDispatcher: {
      outcome: outcomeFactory,
      acceptValidatedOutcome,
    },
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
  it.each(Object.keys(candidates) as BuildWorkKind[])(
    'keeps %s shape rejection before terminal binding',
    async (workKind) => {
      const fixture = harness(workKind, false);
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
    },
  );

  it.each(
    (Object.keys(candidates) as BuildWorkKind[]).flatMap((workKind) =>
      ['domain', 'validator'].map((stage) => ({ stage, workKind })),
    ),
  )('keeps $workKind $stage rejection before terminal binding', async ({ stage, workKind }) => {
    const fixture = harness(workKind);
    await fixture.coordinator.reject('run-1', {
      kind: 'correctable-rejection',
      reasonCode: 'outcome-rejected',
      diagnostic: `${stage} rejected`,
    });
    expect(fixture.rejectHostSubmission).toHaveBeenCalledOnce();
    expect(fixture.acceptValidatedOutcome).not.toHaveBeenCalled();
  });

  it('binds one validated candidate through the guarded acceptance entry', async () => {
    const fixture = harness('build.configure');
    const inspected = fixture.coordinator.inspect({
      work: fixture.work,
      execution: fixture.execution,
    });
    if (!inspected || inspected.kind !== 'candidate') throw new Error('Expected candidate');

    await fixture.coordinator.accept({
      runId: 'run-1',
      candidate: inspected,
      validatorId: 'build.binding-valid',
      assertTransitionFeasible: vi.fn(),
    });

    expect(fixture.acceptValidatedOutcome).toHaveBeenCalledOnce();
    const accepted = fixture.acceptValidatedOutcome.mock.calls[0]?.[0] as {
      outcome: { outcomeId: string };
      validation: {
        stableInputDigest: string;
        submissionId: string;
        workKind: string;
      };
    };
    expect(accepted).toMatchObject({
      outcome: { outcomeId: 'outcome-1' },
      validation: {
        workKind: 'build.configure',
        submissionId: 'submission-1',
        stableInputDigest: fixture.work.inputDigest,
      },
    });
    expect(fixture.rejectHostSubmission).not.toHaveBeenCalled();
  });

  it.each(Object.keys(candidates) as BuildWorkKind[])(
    'does not terminalize %s when transition preflight is infeasible',
    async (workKind) => {
      const fixture = harness(workKind);
      const inspected = fixture.coordinator.inspect({
        work: fixture.work,
        execution: fixture.execution,
      });
      if (!inspected || inspected.kind !== 'candidate') throw new Error('Expected candidate');

      await expect(
        fixture.coordinator.accept({
          runId: 'run-1',
          candidate: inspected,
          validatorId: fixture.work.validatorProfile.id,
          assertTransitionFeasible: () => {
            throw new Error('transition infeasible');
          },
        }),
      ).rejects.toThrow(/transition infeasible/u);
      expect(fixture.acceptValidatedOutcome).not.toHaveBeenCalled();
    },
  );
});
