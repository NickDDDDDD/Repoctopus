import { describe, expect, it } from 'vitest';

import {
  appendRejectedWorkExecutionSubmission,
  classifyWorkExecutionSubmission,
  createWorkExecutionSubmission,
  MAX_REJECTED_WORK_EXECUTION_SUBMISSIONS,
} from '../domains/work-execution/submission.js';
import type { WorkExecutionHostOutcome } from '../domains/work-execution/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function outcome(summary = 'candidate', completedAt = '2026-10-30T00:00:00.000Z') {
  return {
    schemaVersion: 1,
    invocationId: digest('1'),
    hostId: 'host-1',
    packetDigest: digest('2'),
    status: 'succeeded',
    summary,
    consumedLayerDigests: [digest('3')],
    result: {
      schemaVersion: 1,
      kind: 'build-plan-candidate',
      packages: [],
    },
    completedAt,
  } satisfies WorkExecutionHostOutcome;
}

describe('Work execution Host submission identity', () => {
  it('uses a Runtime submission identity and a payload digest independent of receipt time', () => {
    const first = createWorkExecutionSubmission('submission-1', outcome());
    const replay = createWorkExecutionSubmission(
      'submission-1',
      outcome('candidate', '2026-10-30T00:01:00.000Z'),
    );

    expect(first.submissionId).toBe('submission-1');
    expect(first.payloadDigest).toBe(replay.payloadDigest);
    expect(classifyWorkExecutionSubmission({ rejected: [first], candidate: replay })).toBe(
      'duplicate-rejected',
    );
  });

  it('rejects changed content under an existing submission identity', () => {
    const first = createWorkExecutionSubmission('submission-1', outcome());
    const changed = createWorkExecutionSubmission('submission-1', outcome('changed candidate'));

    expect(() =>
      classifyWorkExecutionSubmission({ rejected: [first], candidate: changed }),
    ).toThrow(/submission identity conflict/iu);
  });

  it('bounds immutable rejected submission history without silently truncating it', () => {
    let rejected = [] as ReturnType<typeof appendRejectedWorkExecutionSubmission>;
    for (let index = 0; index < MAX_REJECTED_WORK_EXECUTION_SUBMISSIONS; index += 1) {
      rejected = appendRejectedWorkExecutionSubmission(
        rejected,
        createWorkExecutionSubmission(`submission-${index}`, outcome(`candidate-${index}`)),
        {
          reasonCode: 'outcome-rejected',
          diagnostic: `candidate ${index} was rejected`,
          rejectedAt: '2026-10-30T00:02:00.000Z',
        },
      );
    }

    expect(rejected).toHaveLength(MAX_REJECTED_WORK_EXECUTION_SUBMISSIONS);
    expect(() =>
      appendRejectedWorkExecutionSubmission(
        rejected,
        createWorkExecutionSubmission('overflow', outcome('overflow')),
        {
          reasonCode: 'output-invalid',
          diagnostic: 'overflow',
          rejectedAt: '2026-10-30T00:03:00.000Z',
        },
      ),
    ).toThrow(/rejected submission history is full/iu);
  });

  it('keeps the same claim and Work correctable after Runtime rejection', async () => {
    const intent = {
      runId: 'run-1',
      workId: 'build.plan:1',
      attempt: 1,
      checkEpoch: 7,
      intentId: 'intent-1',
      claimToken: digest('4'),
      inputDigest: digest('5'),
    } as const;
    let state = {
      runId: intent.runId,
      status: 'running',
      stateVersion: 1,
      updatedAt: '2026-10-30T00:00:00.000Z',
      composition: { compositionDigest: digest('6') },
      changeLifecycle: {
        checkEpoch: intent.checkEpoch,
        currentWork: { workId: intent.workId },
      },
      workExecution: {
        schemaVersion: 2,
        workId: intent.workId,
        attempt: intent.attempt,
        checkEpoch: intent.checkEpoch,
        intentId: intent.intentId,
        claimToken: intent.claimToken,
        inputDigest: intent.inputDigest,
        packet: {
          schemaVersion: 1,
          packetId: digest('7'),
          packetDigest: digest('2'),
          contextDigest: digest('8'),
        },
        status: 'invoking',
        continuation: 'wait',
        updatedAt: '2026-10-30T00:00:00.000Z',
      },
    } as unknown as RunState;
    let trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: async <T>(
            _runId: string,
            reduce: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              event?: TrajectoryEvent;
              value: T;
            },
          ) => {
            const reduced = reduce({ state, trajectory });
            if (reduced.state) state = reduced.state;
            if (reduced.event) trajectory = [...trajectory, reduced.event];
            return reduced.value;
          },
          loadRun: async () => state,
          loadWorkflow: async () => ({}),
          loadProjectSnapshot: async () => ({}),
          loadTrajectory: async () => trajectory,
          readTelemetryCursor: async () => ({ trajectoryOffset: trajectory.length }),
          writeTelemetryCursor: async () => undefined,
        },
        workflowTelemetry: { export: async () => undefined },
      },
    });

    const submitted = await authority.markHostCompleted(intent as never, outcome(), 'submission-1');
    expect(submitted).toMatchObject({
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      status: 'submitted',
      pendingSubmission: { submissionId: 'submission-1' },
    });
    expect(submitted.actionOutcome).toBeUndefined();

    const rejected = await authority.rejectHostSubmission({
      intent: intent as never,
      reasonCode: 'outcome-rejected',
      diagnostic: 'Build Plan must cover every Task',
    });
    expect(rejected).toMatchObject({
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      status: 'invoking',
      continuation: 'awaiting-correction',
      pendingSubmission: null,
      rejectedSubmissions: [{ submissionId: 'submission-1' }],
    });

    await expect(
      authority.markHostCompleted(intent as never, outcome(), 'submission-1'),
    ).resolves.toEqual(rejected);
    await expect(
      authority.markHostCompleted(intent as never, outcome('changed candidate'), 'submission-1'),
    ).rejects.toThrow(/submission identity conflict/iu);
  });
});
