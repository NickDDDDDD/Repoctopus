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
          commitGuarded: <T>(
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
            return Promise.resolve(reduced.value);
          },
          loadRun: () => Promise.resolve(state),
          loadWorkflow: () => Promise.resolve({}),
          loadProjectSnapshot: () => Promise.resolve({}),
          loadTrajectory: () => Promise.resolve(trajectory),
          readTelemetryCursor: () => Promise.resolve({ trajectoryOffset: trajectory.length }),
          writeTelemetryCursor: () => Promise.resolve(undefined),
        },
        workflowTelemetry: { export: () => Promise.resolve(undefined) },
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

  it('retains a submitted payload when Runtime processing fails transiently', async () => {
    const intent = {
      runId: 'run-processing-error',
      workId: 'build.plan:processing-error',
      attempt: 1,
      checkEpoch: 9,
      intentId: 'intent-processing-error',
      claimToken: digest('a'),
      inputDigest: digest('b'),
    } as const;
    const pendingSubmission = createWorkExecutionSubmission(
      'submission-processing-error',
      outcome(),
    );
    let state = {
      runId: intent.runId,
      status: 'running',
      stateVersion: 1,
      updatedAt: '2026-10-30T00:00:00.000Z',
      composition: { compositionDigest: digest('c') },
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
          packetId: digest('d'),
          packetDigest: digest('2'),
          contextDigest: digest('e'),
        },
        status: 'submitted',
        continuation: 'execute',
        pendingSubmission,
        updatedAt: '2026-10-30T00:00:00.000Z',
      },
    } as unknown as RunState;
    let trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
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
            return Promise.resolve(reduced.value);
          },
          loadRun: () => Promise.resolve(state),
          loadWorkflow: () => Promise.resolve({}),
          loadProjectSnapshot: () => Promise.resolve({}),
          loadTrajectory: () => Promise.resolve(trajectory),
          readTelemetryCursor: () => Promise.resolve({ trajectoryOffset: trajectory.length }),
          writeTelemetryCursor: () => Promise.resolve(undefined),
        },
        workflowTelemetry: { export: () => Promise.resolve(undefined) },
      },
    });

    const retryable = await authority.rejectHostSubmission({
      intent: intent as never,
      reasonCode: 'outcome-processing-error',
      diagnostic: 'task provider temporarily unavailable',
    });

    expect(retryable).toMatchObject({
      status: 'submitted',
      continuation: 'execute',
      pendingSubmission: { submissionId: 'submission-processing-error' },
      rejectedSubmissions: [],
    });
  });

  it('recovers a legacy premature terminal Outcome into the same correction boundary', async () => {
    const intent = {
      runId: 'run-legacy-plan',
      workId: 'build.plan:legacy',
      attempt: 1,
      checkEpoch: 11,
      intentId: 'intent-legacy-plan',
      claimToken: digest('f'),
      inputDigest: digest('0'),
    } as const;
    const legacyOutcome = outcome('legacy incomplete candidate');
    let state = {
      runId: intent.runId,
      status: 'running',
      stateVersion: 4,
      updatedAt: '2026-10-30T00:00:00.000Z',
      composition: { compositionDigest: digest('1') },
      changeLifecycle: {
        phase: 'build',
        checkEpoch: intent.checkEpoch,
        currentWork: { workId: intent.workId, kind: 'build.plan' },
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
        status: 'outcome',
        continuation: 'wait',
        hostInvocation: {
          schemaVersion: 1,
          invocationId: legacyOutcome.invocationId,
          host: {
            schemaVersion: 1,
            id: legacyOutcome.hostId,
            version: '1',
            codeDigest: digest('9'),
            capabilities: ['build.autonomous'],
            actionKinds: ['agent'],
            reconcile: false,
          },
          packet: {
            schemaVersion: 1,
            packetId: digest('7'),
            packetDigest: digest('2'),
            contextDigest: digest('8'),
          },
          startedAt: '2026-10-30T00:00:00.000Z',
        },
        hostOutcome: legacyOutcome,
        actionOutcome: {
          schemaVersion: 1,
          outcomeId: digest('a'),
          intentId: intent.intentId,
          status: 'succeeded',
          summary: legacyOutcome.summary,
          completedAt: legacyOutcome.completedAt,
        },
        receiptId: digest('b'),
        updatedAt: '2026-10-30T00:00:00.000Z',
      },
    } as unknown as RunState;
    let trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
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
            return Promise.resolve(reduced.value);
          },
          loadRun: () => Promise.resolve(state),
          loadWorkflow: () => Promise.resolve({}),
          loadProjectSnapshot: () => Promise.resolve({}),
          loadTrajectory: () => Promise.resolve(trajectory),
          readTelemetryCursor: () => Promise.resolve({ trajectoryOffset: trajectory.length }),
          writeTelemetryCursor: () => Promise.resolve(undefined),
        },
        workflowTelemetry: { export: () => Promise.resolve(undefined) },
      },
    });

    const recovered = await authority.recoverLegacyRejectedOutcome({
      intent: intent as never,
      diagnostic: 'Legacy Build Plan candidate omitted an authoritative Task',
    });
    expect(recovered).toMatchObject({
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      intentId: intent.intentId,
      status: 'invoking',
      continuation: 'awaiting-correction',
      pendingSubmission: null,
      rejectedSubmissions: [
        {
          outcome: { summary: legacyOutcome.summary },
          rejection: { reasonCode: 'outcome-rejected' },
        },
      ],
    });
    expect(recovered.rejectedSubmissions?.[0]?.submissionId).toMatch(/^legacy:/u);
    expect(recovered.hostInvocation?.invocationId).toBe(legacyOutcome.invocationId);
    expect(recovered.hostOutcome).toBeUndefined();
    expect(recovered.actionOutcome).toBeUndefined();
    expect(recovered.receiptId).toBeUndefined();

    await expect(
      authority.recoverLegacyRejectedOutcome({
        intent: intent as never,
        diagnostic: 'Legacy Build Plan candidate omitted an authoritative Task',
      }),
    ).resolves.toEqual(recovered);
    expect(trajectory.filter((event) => event.type === 'work.outcome-rejected')).toHaveLength(1);
  });
});
