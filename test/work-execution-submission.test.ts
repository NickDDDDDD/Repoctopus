import { describe, expect, it, vi } from 'vitest';

import {
  appendRejectedWorkExecutionSubmission,
  classifyWorkExecutionSubmission,
  createWorkExecutionSubmission,
  MAX_REJECTED_WORK_EXECUTION_SUBMISSIONS,
} from '../domains/work-execution/submission.js';
import type { WorkExecutionHostOutcome } from '../domains/work-execution/types.js';
import type { ActionIntent, ActionReceipt, ClaimedActionOutcome } from '../domains/action/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';
import { createAcceptedBuildWorkOutcome } from '../domains/work-execution/acceptance.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';

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
  function validatedAcceptanceHarness() {
    const intent = {
      schemaVersion: 3,
      runId: 'run-validated',
      workId: 'build.configure:validated',
      attempt: 1,
      checkEpoch: 12,
      intentId: 'intent-validated',
      claimToken: digest('4'),
      inputDigest: digest('5'),
    } as ActionIntent;
    const hostOutcome = {
      ...outcome(),
      result: {
        schemaVersion: 1,
        kind: 'execution-binding-candidate',
        strategyDigest: digest('9'),
      },
    } satisfies WorkExecutionHostOutcome;
    const submission = createWorkExecutionSubmission('submission-validated', hostOutcome);
    const work = {
      workId: intent.workId,
      checkEpoch: intent.checkEpoch,
      kind: 'build.configure',
      inputDigest: intent.inputDigest,
      validatorProfile: { id: 'build.binding-valid' },
    } as WorkDescriptor;
    let state = {
      runId: intent.runId,
      status: 'running',
      stateVersion: 1,
      updatedAt: '2026-11-05T00:00:00.000Z',
      composition: { compositionDigest: digest('6') },
      changeLifecycle: { checkEpoch: intent.checkEpoch, currentWork: work },
      workExecution: {
        schemaVersion: 3,
        workId: intent.workId,
        attempt: intent.attempt,
        checkEpoch: intent.checkEpoch,
        intentId: intent.intentId,
        claimToken: intent.claimToken,
        inputDigest: intent.inputDigest,
        packet: {
          schemaVersion: 1,
          packetId: digest('7'),
          packetDigest: hostOutcome.packetDigest,
          contextDigest: digest('8'),
        },
        status: 'submitted',
        continuation: 'execute',
        hostInvocation: {
          schemaVersion: 1,
          invocationId: hostOutcome.invocationId,
          host: { id: hostOutcome.hostId },
          packet: { packetDigest: hostOutcome.packetDigest },
          startedAt: '2026-11-05T00:00:00.000Z',
        },
        pendingSubmission: submission,
        updatedAt: '2026-11-05T00:00:00.000Z',
      },
    } as unknown as RunState;
    let trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    const recordEvent = vi.fn().mockResolvedValue(undefined);
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
        },
      },
    });
    Object.defineProperties(authority, {
      recordEvent: { value: recordEvent },
      loadAuthoritativePacket: {
        value: vi.fn().mockResolvedValue({ packet: { context: { layers: [] } } }),
      },
      recordSkillOutcomeFacts: { value: vi.fn().mockResolvedValue(undefined) },
      flushTelemetry: { value: vi.fn().mockResolvedValue(undefined) },
    });
    const disposition = createAcceptedBuildWorkOutcome({
      work,
      submission,
      validatorId: work.validatorProfile.id,
    });
    if (disposition.kind !== 'accepted') throw new Error('Expected accepted validation');
    const actionOutcome = {
      schemaVersion: 2,
      outcomeId: 'outcome-validated',
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      claimToken: intent.claimToken,
      inputDigest: intent.inputDigest,
      status: 'succeeded',
      summary: 'validated candidate',
    } satisfies ClaimedActionOutcome;
    const receipt = {
      schemaVersion: 3,
      receiptId: 'receipt-validated',
      intentId: intent.intentId,
      idempotencyKey: 'idempotency-validated',
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      claimToken: intent.claimToken,
      inputDigest: intent.inputDigest,
      outcomeId: actionOutcome.outcomeId,
      compositionDigest: digest('6'),
      actionId: 'action-validated',
      adapter: 'manual',
      outcome: 'succeeded',
      summary: actionOutcome.summary,
      completedAt: '2026-11-05T00:00:01.000Z',
    } satisfies ActionReceipt;
    return {
      actionOutcome,
      authority,
      getState: () => state,
      intent,
      recordEvent,
      receipt,
      validation: disposition.validation,
    };
  }

  it('binds validated submission, Host Outcome, Action Outcome, Receipt and validation atomically', async () => {
    const fixture = validatedAcceptanceHarness();
    const accepted = await fixture.authority.bindValidatedOutcome({
      intent: fixture.intent,
      outcome: fixture.actionOutcome,
      receipt: fixture.receipt,
      validation: fixture.validation,
    });

    expect(accepted).toMatchObject({
      status: 'validated',
      continuation: 'execute',
      pendingSubmission: null,
      acceptedSubmission: { submissionId: fixture.validation.submissionId },
      hostOutcome: { invocationId: digest('1') },
      actionOutcome: { outcomeId: fixture.actionOutcome.outcomeId },
      receiptId: fixture.receipt.receiptId,
      validatorId: fixture.validation.validatorId,
      validationRecord: { validationDigest: fixture.validation.validationDigest },
    });
    expect(fixture.recordEvent).toHaveBeenCalledWith(
      fixture.intent.runId,
      fixture.intent.intentId,
      'work.outcome-accepted',
      expect.objectContaining({
        workKind: 'build.configure',
        validatorId: 'build.binding-valid',
        result: 'succeeded',
      }),
      expect.any(Array),
    );
    expect(fixture.recordEvent).toHaveBeenCalledWith(
      fixture.intent.runId,
      fixture.intent.intentId,
      'validator.completed',
      expect.objectContaining({
        workKind: 'build.configure',
        validatorId: 'build.binding-valid',
        result: 'accepted',
        continuation: 'execute',
      }),
      expect.any(Array),
    );
    expect(
      fixture.recordEvent.mock.calls.filter((call) => call[2] === 'work.outcome-accepted'),
    ).toHaveLength(1);
    expect(
      fixture.recordEvent.mock.calls.filter((call) => call[2] === 'validator.completed'),
    ).toHaveLength(1);
  });

  it('fails closed when stable Work input drifts before validated terminal commit', async () => {
    const fixture = validatedAcceptanceHarness();
    fixture.getState().changeLifecycle!.currentWork = {
      ...fixture.getState().changeLifecycle!.currentWork!,
      inputDigest: digest('0'),
    };

    await expect(
      fixture.authority.bindValidatedOutcome({
        intent: fixture.intent,
        outcome: fixture.actionOutcome,
        receipt: fixture.receipt,
        validation: fixture.validation,
      }),
    ).rejects.toThrow(/stable inputs changed/u);
    expect(fixture.getState().workExecution).toMatchObject({
      status: 'submitted',
      pendingSubmission: { submissionId: fixture.validation.submissionId },
    });
    expect(fixture.getState().workExecution?.acceptedSubmission).toBeUndefined();
    expect(fixture.getState().workExecution?.actionOutcome).toBeUndefined();
    expect(fixture.getState().workExecution?.receiptId).toBeUndefined();
  });

  it('fails closed when the pending candidate changes after validation', async () => {
    const fixture = validatedAcceptanceHarness();
    const pendingOutcome = fixture.getState().workExecution!.pendingSubmission!.outcome as {
      result: {
        schemaVersion: 1;
        kind: 'execution-binding-candidate';
        strategyDigest: `sha256:${string}`;
      };
    };
    pendingOutcome.result = {
      schemaVersion: 1,
      kind: 'execution-binding-candidate',
      strategyDigest: digest('0'),
    };

    await expect(
      fixture.authority.bindValidatedOutcome({
        intent: fixture.intent,
        outcome: fixture.actionOutcome,
        receipt: fixture.receipt,
        validation: fixture.validation,
      }),
    ).rejects.toThrow(/candidate identity changed/u);
    expect(fixture.getState().workExecution).toMatchObject({
      status: 'submitted',
      pendingSubmission: { submissionId: fixture.validation.submissionId },
    });
    expect(fixture.getState().workExecution?.acceptedSubmission).toBeUndefined();
  });

  it('fails closed when the validation record digest is tampered before commit', async () => {
    const fixture = validatedAcceptanceHarness();

    await expect(
      fixture.authority.bindValidatedOutcome({
        intent: fixture.intent,
        outcome: fixture.actionOutcome,
        receipt: fixture.receipt,
        validation: {
          ...fixture.validation,
          validationDigest: digest('0'),
        },
      }),
    ).rejects.toThrow(/validation record.*corrupt/iu);
    expect(fixture.getState().workExecution).toMatchObject({
      status: 'submitted',
      pendingSubmission: { submissionId: fixture.validation.submissionId },
    });
    expect(fixture.getState().workExecution?.validationRecord).toBeUndefined();
  });

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
        schemaVersion: 3,
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
    expect(submitted.acceptedSubmission).toBeUndefined();
    expect(submitted.hostOutcome).toBeUndefined();
    expect(submitted.actionOutcome).toBeUndefined();
    expect(submitted.receiptId).toBeUndefined();

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
        schemaVersion: 3,
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
});
