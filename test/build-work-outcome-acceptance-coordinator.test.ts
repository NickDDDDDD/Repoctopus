import { describe, expect, it, vi } from 'vitest';

import type { ActionIntent } from '../domains/action/types.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { RunState } from '../domains/engine/types.js';
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
  const runState = {
    runId: 'run-1',
    stateVersion: 7,
    projectSnapshotDigest: digest('9'),
    changeLifecycle: { checkEpoch: work.checkEpoch, currentWork: work },
  } as unknown as RunState;
  const loadRun = vi.fn().mockResolvedValue(runState);
  const loadIntent = vi.fn().mockResolvedValue({ runId: 'run-1' });
  const rejectHostSubmission = vi.fn().mockResolvedValue(execution);
  const outcomeFactory = vi.fn(
    (
      intent: ActionIntent,
      status: 'succeeded' | 'failed',
      summary: string,
      outcomeId: string = 'fallback-outcome',
    ) => ({
      schemaVersion: 2 as const,
      outcomeId,
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      claimToken: intent.claimToken,
      inputDigest: intent.inputDigest,
      status,
      summary,
    }),
  );
  const acceptValidatedOutcome = vi.fn().mockResolvedValue({ validation: 'accepted' });
  const coordinator = new BuildWorkOutcomeAcceptanceCoordinator({
    workExecutionAuthority: { loadIntent, rejectHostSubmission },
    loadRun,
    workDispatcher: {
      outcome: outcomeFactory,
      acceptValidatedOutcome,
    },
  });
  return {
    acceptValidatedOutcome,
    coordinator,
    execution,
    loadRun,
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
      validationInput: { strategyDigest: digest('4') },
      transition: { kind: 'build-binding-accepted' },
      assertTransitionFeasible: vi.fn(),
    });

    expect(fixture.acceptValidatedOutcome).toHaveBeenCalledOnce();
    const accepted = fixture.acceptValidatedOutcome.mock.calls[0]?.[0] as {
      outcome: { outcomeId: string };
      validation: {
        expectedStateVersion: number;
        projectSnapshotDigest: string;
        stableInputDigest: string;
        submissionId: string;
        workKind: string;
      };
    };
    expect(accepted).toMatchObject({
      validation: {
        workKind: 'build.configure',
        submissionId: 'submission-1',
        stableInputDigest: fixture.work.inputDigest,
        expectedStateVersion: 7,
        projectSnapshotDigest: digest('9'),
      },
    });
    expect(accepted.outcome.outcomeId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(fixture.rejectHostSubmission).not.toHaveBeenCalled();
  });

  it('reuses one deterministic Outcome identity when terminal binding is retried', async () => {
    const fixture = harness('build.configure');
    const inspected = fixture.coordinator.inspect({
      work: fixture.work,
      execution: fixture.execution,
    });
    if (!inspected || inspected.kind !== 'candidate') throw new Error('Expected candidate');
    fixture.acceptValidatedOutcome
      .mockRejectedValueOnce(new Error('Run state changed after Action Receipt save'))
      .mockResolvedValueOnce({ validation: 'accepted' });
    const input = {
      runId: 'run-1',
      candidate: inspected,
      validatorId: 'build.binding-valid',
      validationInput: { strategyDigest: digest('4') },
      transition: { kind: 'build-binding-accepted' },
      assertTransitionFeasible: vi.fn(),
    };

    await expect(fixture.coordinator.accept(input)).rejects.toThrow(/Receipt save/u);
    await expect(fixture.coordinator.accept(input)).resolves.toMatchObject({
      kind: 'accepted',
      acceptance: { validation: 'accepted' },
    });

    type AcceptanceCall = {
      outcome: { outcomeId: string };
      validation: { outcomeId: string; validationDigest: string };
    };
    const first = fixture.acceptValidatedOutcome.mock.calls[0]?.[0] as unknown as AcceptanceCall;
    const retry = fixture.acceptValidatedOutcome.mock.calls[1]?.[0] as unknown as AcceptanceCall;
    expect(retry.outcome.outcomeId).toBe(first.outcome.outcomeId);
    expect(retry.validation.validationDigest).toBe(first.validation.validationDigest);
    expect(retry.validation.outcomeId).toBe(first.validation.outcomeId);
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
          validationInput: { workKind },
          transition: { kind: 'test-transition' },
          assertTransitionFeasible: () => {
            throw new Error('transition infeasible');
          },
        }),
      ).rejects.toThrow(/transition infeasible/u);
      expect(fixture.acceptValidatedOutcome).not.toHaveBeenCalled();
    },
  );
});
