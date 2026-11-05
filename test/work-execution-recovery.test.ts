import { describe, expect, it, vi } from 'vitest';

import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import type {
  WorkExecutionCheckpoint,
  WorkExecutionHostInvocation,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { createWorkExecutionPacket } from '../domains/work-execution/types.js';
import {
  workExecutionChainIdentity,
  workExecutionRetryPolicy,
} from '../domains/work-execution/retry-policy.js';
import { ManagedWorkExecutor } from '../services/managed-work-executor.js';
import { WorkDispatcher } from '../services/work-dispatcher.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { claimAttemptForContinuation } from '../services/workflow-runs.js';
import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { createLifecyclePhaseWork } from '../domains/change-lifecycle/phase-work.js';
import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { FileWorkExecutionPacketStore } from '../platform/runtime/file-work-execution-packet-store.js';
import {
  compositionFixture,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function checkpoint(status: WorkExecutionCheckpoint['status']): WorkExecutionCheckpoint {
  return {
    schemaVersion: 3,
    workId: 'build:1.1',
    attempt: 1,
    checkEpoch: 4,
    intentId: 'intent-1',
    claimToken: digest('a'),
    inputDigest: digest('b'),
    executionChainId: `execution-chain:${digest('f')}`,
    retryPolicy: 'idempotent',
    packet: {
      schemaVersion: 1,
      packetId: digest('c'),
      packetDigest: digest('d'),
      contextDigest: digest('e'),
    },
    status,
    continuation: status === 'unknown' ? 'reconcile' : 'execute',
    updatedAt: '2026-10-25T00:00:00.000Z',
  };
}

function state(input: {
  runStatus?: RunState['status'];
  execution?: WorkExecutionCheckpoint;
  humanDecision?: boolean;
  currentWork?: boolean;
}): RunState {
  return {
    runId: 'run-recovery',
    status: input.runStatus ?? 'running',
    changeLifecycle: {
      currentWork: input.currentWork === false ? null : { workId: 'build:1.1' },
      checkEpoch: 4,
      waitCondition: input.humanDecision ? { kind: 'human-decision' } : null,
    },
    ...(input.execution ? { workExecution: input.execution } : {}),
  } as unknown as RunState;
}

function recoveryAuthority(run: RunState, input: { active?: boolean; corrupt?: boolean } = {}) {
  const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
  Object.defineProperty(authority, 'ctx', {
    value: {
      runStore: { loadRun: vi.fn().mockResolvedValue(run) },
      workExecutionSessions: { isActive: vi.fn().mockReturnValue(input.active ?? false) },
    },
  });
  authority.loadAuthoritativePacket = input.corrupt
    ? vi.fn().mockRejectedValue(new Error('corrupt'))
    : vi.fn().mockResolvedValue({ intent: {}, packet: {} });
  return authority;
}

describe('Work execution recovery classification', () => {
  it('keeps generic workflow Runs outside the Change Work classifier', async () => {
    const generic = state({});
    delete generic.changeLifecycle;

    await expect(recoveryAuthority(generic).recovery('run-recovery')).resolves.toEqual({
      schemaVersion: 2,
      continuation: 'wait',
      workId: null,
      attempt: null,
      checkEpoch: null,
      reason: 'transition-pending',
    });
  });

  it('grants a durable Host invocation to exactly one concurrent Runner', async () => {
    const initial = checkpoint('context-delivered');
    let run = {
      ...state({ execution: initial }),
      stateVersion: 7,
      composition: { compositionDigest: digest('9') },
      updatedAt: '2026-10-25T00:00:00.000Z',
    } as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: vi.fn(
            <T>(
              _runId: string,
              reduce: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
                state?: RunState;
                event?: TrajectoryEvent;
                value: T;
              },
            ): Promise<T> => {
              const result = reduce({ state: run, trajectory });
              if (result.state) run = result.state;
              if (result.event) trajectory.push(result.event);
              return Promise.resolve(result.value);
            },
          ),
        },
      },
    });
    const invocation: WorkExecutionHostInvocation = {
      schemaVersion: 1,
      invocationId: digest('f'),
      host: {
        schemaVersion: 1,
        id: 'coordinator-1',
        version: '1',
        codeDigest: digest('1'),
        capabilities: [],
        actionKinds: ['agent'],
        reconcile: true,
      },
      packet: initial.packet,
      startedAt: '2026-10-25T00:01:00.000Z',
    };
    const intent = {
      runId: run.runId,
      workId: initial.workId,
      attempt: initial.attempt,
      checkEpoch: initial.checkEpoch,
      intentId: initial.intentId,
    } as never;

    const results = await Promise.all([
      authority.markHostStarted(intent, invocation),
      authority.markHostStarted(intent, { ...invocation, startedAt: '2026-10-25T00:02:00.000Z' }),
    ]);

    expect(results.map((result) => result.acquired)).toEqual([true, false]);
    expect(run.stateVersion).toBe(8);
    expect(run.workExecution).toMatchObject({
      status: 'invoking',
      hostInvocation: { invocationId: invocation.invocationId },
    });
    expect(trajectory.filter((event) => event.type === 'work.host-started')).toHaveLength(1);
  });

  it('projects external publication uncertainty as reconcile until observation succeeds', async () => {
    let run = {
      ...state({ execution: checkpoint('validated') }),
      stateVersion: 7,
      composition: { compositionDigest: digest('9') },
      updatedAt: '2026-10-25T00:00:00.000Z',
    } as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          loadRun: vi.fn(() => Promise.resolve(run)),
          commitGuarded: vi.fn(
            <T>(
              _runId: string,
              reduce: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
                state?: RunState;
                event?: TrajectoryEvent;
                value: T;
              },
            ): Promise<T> => {
              const result = reduce({ state: run, trajectory });
              if (result.state) run = result.state;
              if (result.event) trajectory.push(result.event);
              return Promise.resolve(result.value);
            },
          ),
        },
        workExecutionSessions: { isActive: vi.fn().mockReturnValue(false) },
      },
    });
    authority.loadAuthoritativePacket = vi.fn().mockResolvedValue({ intent: {}, packet: {} });
    const intent = {
      runId: run.runId,
      workId: run.workExecution!.workId,
      attempt: run.workExecution!.attempt,
      checkEpoch: run.workExecution!.checkEpoch,
      intentId: run.workExecution!.intentId,
    } as never;

    await authority.markExternalSideEffectUnknown(intent, 'merge-request');
    await expect(authority.recovery(run.runId)).resolves.toMatchObject({
      continuation: 'reconcile',
      reason: 'external-result-unknown',
    });
    expect(run.workExecution).toMatchObject({
      status: 'unknown',
      continuation: 'reconcile',
      unknownKind: 'external-side-effect',
    });

    await authority.markExternalSideEffectObserved(intent);
    expect(run.workExecution).toMatchObject({ status: 'validated', continuation: 'execute' });
    expect(run.workExecution?.unknownKind).toBeUndefined();
    expect(
      trajectory
        .map((event) => event.type)
        .filter((type) => type === 'reconcile.started' || type === 'reconcile.completed'),
    ).toEqual(['reconcile.started', 'reconcile.completed']);
  });

  it('redelivers the authoritative frozen packet without invoking the context assembler', async () => {
    const packet = { identity: checkpoint('claimed').packet } as WorkExecutionPacket;
    const loadAuthoritativePacket = vi.fn().mockResolvedValue({ intent: {}, packet });
    const recordPacketRecovery = vi.fn().mockResolvedValue(undefined);
    const assemble = vi.fn();
    const dispatcher = Object.create(WorkDispatcher.prototype) as WorkDispatcher;
    Object.defineProperty(dispatcher, 'ctx', {
      value: {
        workContextAssembler: { assemble },
        workExecutionAuthority: { loadAuthoritativePacket, recordPacketRecovery },
      },
    });

    await expect(dispatcher.resumeClaim('run-recovery')).resolves.toEqual({
      intent: {},
      packet,
    });
    expect(loadAuthoritativePacket).toHaveBeenCalledWith('run-recovery');
    expect(recordPacketRecovery).toHaveBeenCalledWith('run-recovery', 'recovered');
    expect(assemble).not.toHaveBeenCalled();
  });

  it.each([
    ['claimed', 'execute', 'claim-redelivery'],
    ['context-delivered', 'execute', 'claim-redelivery'],
    ['unknown', 'reconcile', 'host-result-unknown'],
    ['not-executed', 'execute', 'host-not-executed'],
    ['submitted', 'execute', 'validator-pending'],
  ] as const)('classifies %s without guessing completion', async (status, continuation, reason) => {
    await expect(
      recoveryAuthority(state({ execution: checkpoint(status) })).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation, reason, workId: 'build:1.1', attempt: 1 });
  });

  it('fails closed with migration-required when a persisted checkpoint lacks retry identity', async () => {
    const legacy = checkpoint('not-executed');
    delete legacy.executionChainId;
    delete legacy.retryPolicy;

    await expect(
      recoveryAuthority(state({ execution: legacy })).recovery('run-recovery'),
    ).resolves.toMatchObject({
      continuation: 'reconcile',
      reason: 'migration-required',
      attempt: 1,
    });
  });

  it('fails closed with migration-required when a persisted retry policy is unknown', async () => {
    const malformed = checkpoint('not-executed');
    malformed.retryPolicy = 'always' as never;

    await expect(
      recoveryAuthority(state({ execution: malformed })).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation: 'reconcile', reason: 'migration-required' });
  });

  it('keeps a reconciled rejected submission stably blocked from a new claim', async () => {
    const rejected = {
      ...checkpoint('not-executed'),
      rejectedSubmissions: [
        {
          schemaVersion: 1 as const,
          submissionId: 'rejected-1',
          payloadDigest: digest('1'),
          outcome: {} as never,
          submittedAt: '2026-11-05T00:00:00.000Z',
          rejection: {
            reasonCode: 'outcome-rejected' as const,
            diagnostic: 'invalid',
            rejectedAt: '2026-11-05T00:00:01.000Z',
          },
        },
      ],
    };

    await expect(
      recoveryAuthority(state({ execution: rejected })).recovery('run-recovery'),
    ).resolves.toMatchObject({
      continuation: 'wait',
      reason: 'retry-policy-blocked',
      attempt: 1,
    });
  });

  it('selects the persisted attempt only for claim redelivery', () => {
    const execution = checkpoint('context-delivered');
    const work = { workId: execution.workId };

    expect(claimAttemptForContinuation('claim-redelivery', execution, work)).toBe(1);
    expect(claimAttemptForContinuation('host-not-executed', execution, work)).toBe(2);
    expect(claimAttemptForContinuation('work-failed', execution, work)).toBe(2);
    expect(claimAttemptForContinuation('checkpoint-superseded', execution, work)).toBeUndefined();
  });

  it.each(['open', 'design', 'build', 'verify', 'archive'] as const)(
    'stably blocks exhausted %s Work instead of requesting attempt four',
    async (phase) => {
      for (const execution of [
        { ...checkpoint('not-executed'), attempt: 3 },
        {
          ...checkpoint('outcome'),
          attempt: 3,
          actionOutcome: { status: 'failed' } as never,
        },
      ]) {
        const run = state({ execution });
        run.changeLifecycle = { ...run.changeLifecycle, phase } as never;

        await expect(recoveryAuthority(run).recovery('run-recovery')).resolves.toMatchObject({
          continuation: 'wait',
          reason: 'retry-policy-blocked',
          attempt: 3,
        });
      }
    },
  );

  it('reobserves the Open gate after the Work has already been validated', async () => {
    const run = state({ execution: checkpoint('validated') });
    run.changeLifecycle = { ...run.changeLifecycle!, phase: 'open' } as never;

    await expect(recoveryAuthority(run).recovery('run-recovery')).resolves.toMatchObject({
      continuation: 'reobserve',
      reason: 'open-gate-pending',
      workId: 'build:1.1',
      attempt: 1,
    });
  });

  it('keeps non-Open validated Work on the transition continuation', async () => {
    const run = state({ execution: checkpoint('validated') });
    run.changeLifecycle = { ...run.changeLifecycle!, phase: 'design' } as never;

    await expect(recoveryAuthority(run).recovery('run-recovery')).resolves.toMatchObject({
      continuation: 'execute',
      reason: 'transition-pending',
    });
  });

  it('keeps rejected submissions on the same Work awaiting a corrected payload', async () => {
    await expect(
      recoveryAuthority(
        state({
          execution: {
            ...checkpoint('invoking'),
            continuation: 'awaiting-correction',
          },
        }),
      ).recovery('run-recovery'),
    ).resolves.toMatchObject({
      continuation: 'awaiting-correction',
      reason: 'outcome-rejected',
      workId: 'build:1.1',
      attempt: 1,
    });
  });

  it('projects the lifecycle Work instead of a superseded execution checkpoint', async () => {
    const run = state({ execution: checkpoint('validated') });
    run.changeLifecycle = {
      ...run.changeLifecycle!,
      checkEpoch: 5,
      currentWork: { workId: 'design:replacement' },
    } as never;
    const authority = recoveryAuthority(run);

    await expect(authority.recovery('run-recovery')).resolves.toMatchObject({
      continuation: 'execute',
      reason: 'checkpoint-superseded',
      workId: 'design:replacement',
      attempt: null,
      checkEpoch: 5,
    });
    await expect(authority.continuation('run-recovery')).resolves.toBe('execute');
  });

  it.each([
    ['the same Work in a newer epoch', 'build:1.1'],
    ['a different Work in a newer epoch', 'build:1.2'],
  ])('keeps an unresolved external result as a barrier before %s', async (_label, workId) => {
    const unresolved = {
      ...checkpoint('unknown'),
      unknownKind: 'external-side-effect' as const,
      continuation: 'reconcile' as const,
    };
    const run = state({ execution: unresolved });
    run.changeLifecycle = {
      ...run.changeLifecycle!,
      checkEpoch: unresolved.checkEpoch + 1,
      currentWork: { workId },
    } as never;

    await expect(recoveryAuthority(run).recovery('run-recovery')).resolves.toMatchObject({
      continuation: 'reconcile',
      reason: 'checkpoint-superseded-unresolved',
      workId: unresolved.workId,
      attempt: unresolved.attempt,
      checkEpoch: unresolved.checkEpoch,
    });
  });

  it('reconciles a superseded checkpoint once before the next protected pull', async () => {
    let run = {
      ...state({ execution: checkpoint('validated') }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
      changeLifecycle: {
        ...state({}).changeLifecycle!,
        phase: 'design',
        checkEpoch: 5,
        currentWork: { workId: 'design:replacement', kind: 'specification.plan' },
      },
    } as unknown as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const commitGuarded = vi.fn(
      (
        _runId: string,
        commit: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
          state?: RunState;
          event?: TrajectoryEvent;
          value: boolean;
        },
      ) => {
        const result = commit({ state: run, trajectory });
        if (result.state) run = result.state;
        if (result.event) trajectory.push(result.event);
        return Promise.resolve(result.value);
      },
    );
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded,
          loadRun: vi.fn(() => Promise.resolve(run)),
        },
      },
    });

    await expect(authority.reconcileCurrentCheckpoint(run.runId)).resolves.toBe(true);
    await expect(authority.reconcileCurrentCheckpoint(run.runId)).resolves.toBe(false);
    expect(run.workExecution).toBeUndefined();
    expect(trajectory).toHaveLength(1);
    expect(trajectory[0]).toMatchObject({
      type: 'recovery.reconciled',
      data: {
        reasonCode: 'checkpoint-superseded',
        retiredWorkId: 'build:1.1',
        nextWorkId: 'design:replacement',
        nextCheckEpoch: 5,
      },
    });
  });

  it('does not retire a superseded unresolved checkpoint before reconciliation', async () => {
    const unresolved = {
      ...checkpoint('unknown'),
      unknownKind: 'external-side-effect' as const,
      continuation: 'reconcile' as const,
    };
    const run = {
      ...state({ execution: unresolved }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
      changeLifecycle: {
        ...state({}).changeLifecycle!,
        checkEpoch: unresolved.checkEpoch + 1,
        currentWork: { workId: 'build:1.2' },
      },
    } as unknown as RunState;
    const commitGuarded = vi.fn(
      (
        _runId: string,
        commit: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
          state?: RunState;
          event?: TrajectoryEvent;
          value: boolean;
        },
      ) => Promise.resolve(commit({ state: run, trajectory: [] }).value),
    );
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', { value: { runStore: { commitGuarded } } });

    await expect(authority.reconcileCurrentCheckpoint(run.runId)).resolves.toBe(false);
    expect(run.workExecution).toEqual(unresolved);
  });

  it('persists duplicate continuation pulls as suppressed dispatch facts without replaying Work', async () => {
    let run = {
      ...state({ execution: checkpoint('claimed') }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
    } as unknown as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: (
            _runId: string,
            commit: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              event?: TrajectoryEvent;
              value: undefined;
            },
          ) => {
            const result = commit({ state: run, trajectory });
            if (result.state) run = result.state;
            if (result.event) trajectory.push(result.event);
            return Promise.resolve(result.value);
          },
        },
      },
    });
    const recovery = {
      schemaVersion: 2 as const,
      continuation: 'execute' as const,
      workId: 'build:1.1',
      attempt: 1,
      checkEpoch: 4,
      reason: 'claim-redelivery' as const,
    };

    await authority.recordContinuation(run.runId, recovery);
    await authority.recordContinuation(run.runId, recovery);

    expect(trajectory).toHaveLength(2);
    expect(trajectory[0]).toMatchObject({
      type: 'continuation.selected',
      data: { result: 'selected', dispatchSuppressed: false },
    });
    expect(trajectory[1]).toMatchObject({
      type: 'continuation.selected',
      data: { result: 'suppressed', dispatchSuppressed: true },
    });
    expect(run.workExecution).toEqual(checkpoint('claimed'));
  });

  it('counts one unavailable Open observation while suppressing its duplicate dispatch', async () => {
    let run = {
      ...state({ execution: checkpoint('validated') }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
    } as unknown as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: (
            _runId: string,
            commit: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              event?: TrajectoryEvent;
              value: undefined;
            },
          ) => {
            const result = commit({ state: run, trajectory });
            if (result.state) run = result.state;
            if (result.event) trajectory.push(result.event);
            return Promise.resolve(result.value);
          },
        },
      },
    });
    const recovery = {
      schemaVersion: 2 as const,
      continuation: 'reobserve' as const,
      workId: 'build:1.1',
      attempt: 1,
      checkEpoch: 4,
      reason: 'open-observation-unavailable' as const,
      observationStage: 'planning-gate' as const,
    };

    await authority.recordContinuation(run.runId, recovery);
    await authority.recordContinuation(run.runId, recovery);

    expect(trajectory.map((event) => event.data.result)).toEqual(['unavailable', 'suppressed']);
    expect(trajectory[0]?.data).toMatchObject({
      observationStage: 'planning-gate',
      hostReplayed: false,
    });
  });

  it('distinguishes active, unknown, failed, validator, human and corrupt boundaries', async () => {
    const invocation: WorkExecutionHostInvocation = {
      schemaVersion: 1,
      invocationId: digest('f'),
      host: {
        schemaVersion: 1,
        id: 'host',
        version: '1',
        codeDigest: digest('1'),
        capabilities: [],
        actionKinds: ['agent'],
        reconcile: true,
      },
      packet: checkpoint('invoking').packet,
      startedAt: '2026-10-25T00:00:00.000Z',
    };
    const invoking = { ...checkpoint('invoking'), hostInvocation: invocation };
    await expect(
      recoveryAuthority(state({ execution: invoking }), { active: true }).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation: 'wait', reason: 'host-active' });
    await expect(
      recoveryAuthority(state({ execution: invoking })).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation: 'reconcile', reason: 'host-result-unknown' });
    await expect(
      recoveryAuthority(
        state({
          execution: { ...checkpoint('outcome'), actionOutcome: { status: 'failed' } as never },
        }),
      ).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation: 'execute', reason: 'work-failed' });
    await expect(
      recoveryAuthority(
        state({
          execution: { ...checkpoint('outcome'), actionOutcome: { status: 'succeeded' } as never },
        }),
      ).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation: 'execute', reason: 'validator-pending' });
    await expect(
      recoveryAuthority(state({ humanDecision: true })).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation: 'ask', reason: 'human-decision' });
    await expect(
      recoveryAuthority(state({ execution: checkpoint('claimed') }), { corrupt: true }).recovery(
        'run-recovery',
      ),
    ).resolves.toMatchObject({ continuation: 'reconcile', reason: 'content-missing-or-corrupt' });
  });
});

describe('Work execution epoch authority', () => {
  it('never binds a claim before immutable packet persistence succeeds', async () => {
    const currentWork = {
      workId: 'build:1.1',
      inputDigest: digest('b'),
      checkEpoch: 4,
      phase: 'build',
      kind: 'build.execute',
    };
    const run = {
      ...state({}),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
      changeLifecycle: { phase: 'build', checkEpoch: 4, currentWork, waitCondition: null },
    } as unknown as RunState;
    const packet = {
      identity: checkpoint('claimed').packet,
      claim: {
        runId: run.runId,
        workId: currentWork.workId,
        attempt: 1,
        checkEpoch: currentWork.checkEpoch,
        intentId: 'intent-1',
        claimToken: digest('a'),
        inputDigest: currentWork.inputDigest,
      },
      work: currentWork,
      context: { digest: checkpoint('claimed').packet.contextDigest },
    } as unknown as WorkExecutionPacket;
    const commitGuarded = vi.fn();
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: { commitGuarded },
        workExecutionPacketStore: {
          save: vi.fn().mockRejectedValue(new Error('packet persistence failed')),
        },
      },
    });

    await expect(authority.bindClaim(packet)).rejects.toThrow('packet persistence failed');
    expect(commitGuarded).not.toHaveBeenCalled();
  });

  it.each([2, 3])(
    'rejects first claim attempt %s when no authoritative chain exists',
    async (attempt) => {
      const currentWork = {
        workId: 'build:1.1',
        inputDigest: digest('b'),
        checkEpoch: 4,
        sideEffectClass: 'repository-write' as const,
      };
      let run = {
        ...state({}),
        stateVersion: 10,
        composition: { compositionDigest: digest('9') },
        changeLifecycle: { checkEpoch: 4, currentWork, waitCondition: null },
      } as unknown as RunState;
      const packet = {
        identity: {
          schemaVersion: 1,
          packetId: digest('1'),
          packetDigest: digest('2'),
          contextDigest: digest('3'),
        },
        claim: {
          runId: run.runId,
          workId: currentWork.workId,
          attempt,
          checkEpoch: currentWork.checkEpoch,
          intentId: `intent-${attempt}`,
          claimToken: digest('4'),
          inputDigest: currentWork.inputDigest,
        },
        work: currentWork,
        context: { digest: digest('3') },
      } as unknown as WorkExecutionPacket;
      const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
      Object.defineProperty(authority, 'ctx', {
        value: {
          runStore: {
            commitGuarded: <T>(
              _runId: string,
              reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
                state?: RunState;
                value: T;
              },
            ): Promise<T> => {
              const reduced = reduce({ state: run, trajectory: [] });
              if (reduced.state) run = reduced.state;
              return Promise.resolve(reduced.value);
            },
          },
          workExecutionPacketStore: {
            save: vi.fn().mockResolvedValue({ status: 'created', packet }),
          },
        },
      });

      await expect(authority.bindClaim(packet)).rejects.toThrow(/attempt 1/u);
      expect(run.workExecution).toBeUndefined();
    },
  );

  it('accepts the next ordered attempt when Runtime reissues the same semantic Work in a newer epoch', async () => {
    const previous = checkpoint('validated');
    const currentWork = {
      workId: previous.workId,
      inputDigest: previous.inputDigest,
      checkEpoch: previous.checkEpoch + 1,
    };
    let run = {
      ...state({ execution: previous }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
      changeLifecycle: { checkEpoch: currentWork.checkEpoch, currentWork, waitCondition: null },
    } as unknown as RunState;
    const packet = {
      identity: {
        schemaVersion: 1,
        packetId: digest('1'),
        packetDigest: digest('2'),
        contextDigest: digest('3'),
      },
      claim: {
        runId: run.runId,
        workId: currentWork.workId,
        attempt: previous.attempt + 1,
        checkEpoch: currentWork.checkEpoch,
        intentId: 'intent-2',
        claimToken: digest('4'),
        inputDigest: currentWork.inputDigest,
      },
      work: currentWork,
      context: { digest: digest('3') },
    } as unknown as WorkExecutionPacket;
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    const commitGuarded = vi.fn(
      <T>(
        _runId: string,
        reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
          state?: RunState;
          value: T;
        },
      ): Promise<T> => {
        const reduced = reduce({ state: run, trajectory: [] });
        if (reduced.state) run = reduced.state;
        return Promise.resolve(reduced.value);
      },
    );
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: { commitGuarded },
        workExecutionPacketStore: {
          save: vi.fn().mockResolvedValue({ status: 'created', packet }),
        },
      },
    });

    await expect(authority.bindClaim(packet)).resolves.toMatchObject({
      workId: previous.workId,
      attempt: 2,
      checkEpoch: 5,
      status: 'claimed',
    });
    expect(run.workExecution).toMatchObject({ intentId: 'intent-2', checkEpoch: 5 });
    expect(run.workExecution).not.toHaveProperty('attemptHistory');
  });

  it('preserves the complete failed attempt across restart when continue-build claims the next attempt', async () => {
    const base = checkpoint('outcome');
    const currentWork = {
      workId: base.workId,
      inputDigest: base.inputDigest,
      checkEpoch: base.checkEpoch,
      sideEffectClass: 'repository-write' as const,
    };
    const previous = {
      ...base,
      executionChainId: workExecutionChainIdentity(currentWork),
      retryPolicy: workExecutionRetryPolicy(currentWork),
      continuation: 'execute' as const,
      hostInvocation: {
        schemaVersion: 1 as const,
        invocationId: digest('f'),
        host: {
          schemaVersion: 1 as const,
          id: 'host-1',
          version: '1',
          codeDigest: digest('1'),
          capabilities: ['process.execute'],
          actionKinds: ['agent' as const],
          reconcile: true,
        },
        packet: base.packet,
        startedAt: '2026-10-25T00:01:00.000Z',
      },
      acceptedSubmission: {
        schemaVersion: 1 as const,
        submissionId: 'submission-failed',
        payloadDigest: digest('3'),
        outcome: {
          schemaVersion: 1 as const,
          invocationId: digest('f'),
          hostId: 'host-1',
          packetDigest: base.packet.packetDigest,
          status: 'failed' as const,
          summary: 'implementation failed',
          consumedLayerDigests: [],
          completedAt: '2026-10-25T00:04:00.000Z',
        },
        submittedAt: '2026-10-25T00:04:00.000Z',
      },
      actionOutcome: {
        schemaVersion: 2,
        outcomeId: 'outcome-failed',
        runId: 'run-recovery',
        workId: base.workId,
        attempt: base.attempt,
        checkEpoch: base.checkEpoch,
        claimToken: base.claimToken,
        inputDigest: base.inputDigest,
        status: 'failed' as const,
        summary: 'implementation failed',
      },
      updatedAt: '2026-10-25T00:05:00.000Z',
    } as WorkExecutionCheckpoint;
    let run = JSON.parse(
      JSON.stringify({
        ...state({ execution: previous }),
        stateVersion: 10,
        composition: { compositionDigest: digest('9') },
        changeLifecycle: { checkEpoch: previous.checkEpoch, currentWork, waitCondition: null },
      }),
    ) as RunState;
    const packet = {
      identity: {
        schemaVersion: 1,
        packetId: digest('4'),
        packetDigest: digest('5'),
        contextDigest: digest('6'),
      },
      claim: {
        runId: run.runId,
        workId: currentWork.workId,
        attempt: 2,
        checkEpoch: currentWork.checkEpoch,
        intentId: 'intent-2',
        claimToken: digest('7'),
        inputDigest: currentWork.inputDigest,
      },
      work: currentWork,
      context: { digest: digest('6') },
    } as unknown as WorkExecutionPacket;
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
            _runId: string,
            reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              value: T;
            },
          ): Promise<T> => {
            const reduced = reduce({ state: run, trajectory: [] });
            if (reduced.state) run = reduced.state;
            return Promise.resolve(reduced.value);
          },
        },
        workExecutionPacketStore: {
          save: vi.fn().mockResolvedValue({ status: 'created', packet }),
        },
      },
    });

    await expect(authority.bindClaim(packet)).resolves.toMatchObject({
      workId: previous.workId,
      attempt: 2,
      checkEpoch: previous.checkEpoch,
      status: 'claimed',
    });
    expect(run.workExecution?.attemptHistory).toEqual([previous]);
    expect(run.workExecution).not.toHaveProperty('acceptedSubmission');
    expect(run.workExecution).not.toHaveProperty('hostInvocation');
  });

  it('round-trips a flat attempt chain through FileRuntimeStore and rejects an old candidate replay', async () => {
    const workspace = await temporaryDirectory('repoctopus-continue-build-restart-');
    try {
      const runId = 'run-continue-build-restart';
      const project = projectFixture({ projectId: 'continue-build' });
      const store = new FileRuntimeStore(workspace);
      const runtime = new WorkflowRunCoordinator(
        store,
        { async export() {} },
        compositionFixture(),
      );
      const actionSkill = {
        schemaVersion: 1 as const,
        name: 'repoctopus-open-change',
        provider: 'repoctopus-builtins',
        invocation: { modelInvocable: true, userInvocable: false },
        contentDigest: digest('1'),
        resourceManifestDigest: digest('2'),
      };
      const augmentationSkill = {
        schemaVersion: 1 as const,
        name: 'grilling',
        provider: 'matt-builtins',
        invocation: { modelInvocable: true, userInvocable: true },
        contentDigest: digest('8'),
        resourceManifestDigest: digest('9'),
      };
      const work = createLifecyclePhaseWork({
        runId,
        checkEpoch: 4,
        changeId: 'continue-build-restart',
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'change.intake',
        actionSkill,
        augmentationSkills: [augmentationSkill],
        compositionDigest: compositionFixture().compositionDigest,
        projectSnapshotDigest: project.digest,
        projectConfigDigest: digest('3'),
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace'],
      });
      await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: project,
        runId,
        changeLifecycle: {
          ...createChangeLifecycleSnapshot({
            identity: {
              workspaceId: 'continue-build',
              changeId: 'continue-build-restart',
              runId,
            },
          }),
          checkEpoch: work.checkEpoch,
          currentWork: work,
        },
      });
      const first = {
        ...checkpoint('outcome'),
        workId: work.workId,
        checkEpoch: work.checkEpoch,
        inputDigest: work.inputDigest,
        executionChainId: workExecutionChainIdentity(work),
        retryPolicy: workExecutionRetryPolicy(work),
        hostInvocation: {
          schemaVersion: 1 as const,
          invocationId: digest('4'),
          host: {
            schemaVersion: 1 as const,
            id: 'host-1',
            version: '1',
            codeDigest: digest('5'),
            capabilities: [...work.capabilities],
            actionKinds: ['agent' as const],
            reconcile: true,
          },
          packet: checkpoint('outcome').packet,
          startedAt: '2026-10-25T00:01:00.000Z',
        },
        actionOutcome: {
          schemaVersion: 2 as const,
          outcomeId: 'outcome-1',
          runId,
          workId: work.workId,
          attempt: 1,
          checkEpoch: work.checkEpoch,
          claimToken: checkpoint('outcome').claimToken,
          inputDigest: work.inputDigest,
          status: 'failed' as const,
          summary: 'attempt one failed',
        },
      } satisfies WorkExecutionCheckpoint;
      await store.commitGuarded(runId, ({ state: current, trajectory }) => {
        const nextState: RunState = {
          ...current,
          workExecution: first,
          stateVersion: current.stateVersion + 1,
          updatedAt: '2026-10-25T00:02:00.000Z',
        };
        return {
          state: nextState,
          event: {
            schemaVersion: 1,
            sequence: trajectory.length + 1,
            eventId: 'seed-attempt-one',
            timestamp: nextState.updatedAt,
            type: 'work.completed',
            runId,
            stateVersion: nextState.stateVersion,
            compositionDigest: nextState.composition.compositionDigest,
            data: { workId: work.workId, attempt: 1 },
          },
          value: undefined,
        };
      });
      const intentFor = (attempt: number, character: string) => ({
        schemaVersion: 3 as const,
        intentId: `intent-${attempt}`,
        idempotencyKey: `continue-build-${attempt}`,
        runId,
        workId: work.workId,
        attempt,
        checkEpoch: work.checkEpoch,
        claimToken: digest(character),
        inputDigest: work.inputDigest,
        compositionDigest: compositionFixture().compositionDigest,
        composition: compositionFixture(),
        action: {
          id: work.workId,
          stepId: `open:${work.kind}`,
          type: 'invoke_skill' as const,
          ref: work.actionSkill!.name,
          summary: `Execute ${work.kind}`,
        },
        adapter: 'manual',
        executionContext: { digest: digest(character), layers: [] },
        createdAt: '2026-10-25T00:02:00.000Z',
      });
      const packetFor = (attempt: number, character: string) =>
        createWorkExecutionPacket({
          intent: intentFor(attempt, character),
          work,
          context: {
            schemaVersion: 1,
            workId: work.workId,
            layers: [],
            digest: digest(character),
          },
        });
      const bind = async (packet: WorkExecutionPacket) => {
        const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
        Object.defineProperty(authority, 'ctx', {
          value: {
            runStore: new FileRuntimeStore(workspace),
            workExecutionPacketStore: new FileWorkExecutionPacketStore(workspace),
          },
        });
        return authority.bindClaim(packet);
      };

      const secondPacket = packetFor(2, '6');
      await bind(secondPacket);
      const afterRestart = await new FileRuntimeStore(workspace).loadRun(runId);
      expect(afterRestart.workExecution?.attemptHistory).toEqual([first]);

      await new FileRuntimeStore(workspace).commitGuarded(
        runId,
        ({ state: current, trajectory }) => {
          const nextState: RunState = {
            ...current,
            workExecution: { ...current.workExecution!, status: 'context-delivered' },
            stateVersion: current.stateVersion + 1,
            updatedAt: '2026-10-25T00:02:30.000Z',
          };
          return {
            state: nextState,
            event: {
              schemaVersion: 1,
              sequence: trajectory.length + 1,
              eventId: 'seed-context-delivered',
              timestamp: nextState.updatedAt,
              type: 'work.context-delivered',
              runId,
              stateVersion: nextState.stateVersion,
              compositionDigest: nextState.composition.compositionDigest,
              data: { workId: work.workId, attempt: 2 },
            },
            value: undefined,
          };
        },
      );
      const restartedAuthority = Object.create(
        WorkExecutionAuthority.prototype,
      ) as WorkExecutionAuthority;
      Object.defineProperty(restartedAuthority, 'ctx', {
        value: {
          runStore: new FileRuntimeStore(workspace),
          workExecutionPacketStore: new FileWorkExecutionPacketStore(workspace),
        },
      });
      restartedAuthority.loadIntent = vi.fn().mockResolvedValue(intentFor(2, '6'));
      const restartedDispatcher = Object.create(WorkDispatcher.prototype) as WorkDispatcher;
      Object.defineProperty(restartedDispatcher, 'contributors', { value: new Map() });
      const assemble = vi.fn();
      Object.defineProperty(restartedDispatcher, 'ctx', {
        value: {
          runStore: new FileRuntimeStore(workspace),
          workExecutionAuthority: restartedAuthority,
          workContextAssembler: { assemble },
        },
      });
      restartedDispatcher.register({
        id: 'manual',
        identity: { id: 'manual', kind: 'work' } as never,
        requiredCapabilities: [],
      });
      const redeliveryAttempt = claimAttemptForContinuation(
        'claim-redelivery',
        (await new FileRuntimeStore(workspace).loadRun(runId)).workExecution,
        work,
      );
      expect(redeliveryAttempt).toBe(2);
      if (redeliveryAttempt === undefined) throw new Error('Expected a redelivery attempt');
      const redelivered = await restartedDispatcher.claim({
        runId,
        adapter: 'manual',
        attempt: redeliveryAttempt,
        executor: {
          actorId: 'runtime',
          runnerId: 'runtime:restart',
          source: 'runner',
          authenticated: true,
        },
      });
      expect(redelivered.packet.identity).toEqual(secondPacket.identity);
      expect(redelivered.intent.attempt).toBe(2);
      expect(assemble).not.toHaveBeenCalled();

      const replayExecutor = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
      const staleSubmission = vi.fn();
      Object.defineProperty(replayExecutor, 'ctx', {
        value: {
          runStore: new FileRuntimeStore(workspace),
          workExecutionAuthority: {
            loadIntent: vi.fn().mockResolvedValue({ intentId: first.intentId }),
            markHostCompleted: staleSubmission,
          },
        },
      });
      await expect(
        replayExecutor.acceptExternalOutcome({
          schemaVersion: 3,
          runId,
          submissionId: 'stale-submission',
          invocationId: first.hostInvocation.invocationId,
          hostId: first.hostInvocation.host.id,
          packetDigest: first.packet.packetDigest,
          status: 'failed',
          summary: 'stale result',
          consumedLayerDigests: [],
        }),
      ).rejects.toThrow(/authoritative invocation/u);
      expect(staleSubmission).not.toHaveBeenCalled();

      await new FileRuntimeStore(workspace).commitGuarded(
        runId,
        ({ state: current, trajectory }) => {
          const nextState: RunState = {
            ...current,
            workExecution: {
              ...current.workExecution!,
              status: 'outcome',
              actionOutcome: {
                schemaVersion: 2,
                outcomeId: 'outcome-2',
                runId,
                workId: work.workId,
                attempt: 2,
                checkEpoch: work.checkEpoch,
                claimToken: current.workExecution!.claimToken,
                inputDigest: work.inputDigest,
                status: 'failed',
                summary: 'attempt two failed',
              },
            },
            stateVersion: current.stateVersion + 1,
            updatedAt: '2026-10-25T00:04:00.000Z',
          };
          return {
            state: nextState,
            event: {
              schemaVersion: 1,
              sequence: trajectory.length + 1,
              eventId: 'seed-attempt-two-failure',
              timestamp: nextState.updatedAt,
              type: 'work.completed',
              runId,
              stateVersion: nextState.stateVersion,
              compositionDigest: nextState.composition.compositionDigest,
              data: { workId: work.workId, attempt: 2 },
            },
            value: undefined,
          };
        },
      );
      await bind(packetFor(3, '7'));
      const thirdRestart = await new FileRuntimeStore(workspace).loadRun(runId);
      expect(thirdRestart.workExecution?.attemptHistory?.map((entry) => entry.attempt)).toEqual([
        1, 2,
      ]);
      expect(
        thirdRestart.workExecution?.attemptHistory?.every(
          (entry) => !Object.hasOwn(entry, 'attemptHistory'),
        ),
      ).toBe(true);
    } finally {
      await removeTemporaryDirectory(workspace);
    }
  });

  it('keeps a rejected submission on the current correction attempt', async () => {
    const base = checkpoint('outcome');
    const currentWork = {
      workId: base.workId,
      inputDigest: base.inputDigest,
      checkEpoch: base.checkEpoch,
      sideEffectClass: 'repository-write' as const,
    };
    const rejectedSubmission = {
      schemaVersion: 1 as const,
      submissionId: 'submission-rejected',
      payloadDigest: digest('2'),
      outcome: {
        schemaVersion: 1 as const,
        invocationId: digest('f'),
        hostId: 'host-1',
        packetDigest: base.packet.packetDigest,
        status: 'failed' as const,
        summary: 'candidate rejected',
        consumedLayerDigests: [],
        completedAt: '2026-10-25T00:02:00.000Z',
      },
      submittedAt: '2026-10-25T00:02:00.000Z',
      rejection: {
        reasonCode: 'outcome-rejected' as const,
        diagnostic: 'invalid result',
        rejectedAt: '2026-10-25T00:03:00.000Z',
      },
    };
    const previous = {
      ...base,
      executionChainId: workExecutionChainIdentity(currentWork),
      retryPolicy: workExecutionRetryPolicy(currentWork),
      rejectedSubmissions: [rejectedSubmission],
      acceptedSubmission: {
        ...rejectedSubmission,
        submissionId: 'submission-failed',
      },
      actionOutcome: {
        schemaVersion: 2 as const,
        outcomeId: 'outcome-failed',
        runId: 'run-recovery',
        workId: base.workId,
        attempt: base.attempt,
        checkEpoch: base.checkEpoch,
        claimToken: base.claimToken,
        inputDigest: base.inputDigest,
        status: 'failed' as const,
        summary: 'implementation failed',
      },
    } as WorkExecutionCheckpoint;
    let run = JSON.parse(
      JSON.stringify({
        ...state({ execution: previous }),
        stateVersion: 10,
        composition: { compositionDigest: digest('9') },
        changeLifecycle: { checkEpoch: previous.checkEpoch, currentWork, waitCondition: null },
      }),
    ) as RunState;
    const packet = {
      identity: {
        schemaVersion: 1,
        packetId: digest('4'),
        packetDigest: digest('5'),
        contextDigest: digest('6'),
      },
      claim: {
        runId: run.runId,
        workId: currentWork.workId,
        attempt: 2,
        checkEpoch: currentWork.checkEpoch,
        intentId: 'intent-2',
        claimToken: digest('7'),
        inputDigest: currentWork.inputDigest,
      },
      work: currentWork,
      context: { digest: digest('6') },
    } as unknown as WorkExecutionPacket;
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
            _runId: string,
            reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              value: T;
            },
          ): Promise<T> => {
            const reduced = reduce({ state: run, trajectory: [] });
            if (reduced.state) run = reduced.state;
            return Promise.resolve(reduced.value);
          },
        },
        workExecutionPacketStore: {
          save: vi.fn().mockResolvedValue({ status: 'created', packet }),
        },
      },
    });

    await expect(recoveryAuthority(run).recovery(run.runId)).resolves.toMatchObject({
      continuation: 'wait',
      reason: 'retry-policy-blocked',
      attempt: 1,
    });
    await expect(authority.bindClaim(packet)).rejects.toThrow(/authoritative claim/u);
    expect(run.workExecution?.rejectedSubmissions).toEqual([rejectedSubmission]);
    expect(run.workExecution?.attempt).toBe(1);

    const reconciled = structuredClone(previous);
    reconciled.status = 'not-executed';
    delete reconciled.actionOutcome;
    run = { ...run, workExecution: reconciled };
    await expect(recoveryAuthority(run).recovery(run.runId)).resolves.toMatchObject({
      continuation: 'wait',
      reason: 'retry-policy-blocked',
      attempt: 1,
    });
    await expect(authority.bindClaim(packet)).rejects.toThrow(/authoritative claim/u);
    expect(run.workExecution).toEqual(reconciled);
  });

  it('does not reconcile an awaiting-correction invocation into not-executed', async () => {
    const previous = {
      ...checkpoint('invoking'),
      continuation: 'awaiting-correction' as const,
      rejectedSubmissions: [
        {
          schemaVersion: 1 as const,
          submissionId: 'rejected-1',
          payloadDigest: digest('1'),
          outcome: {} as never,
          submittedAt: '2026-11-05T00:00:00.000Z',
          rejection: {
            reasonCode: 'outcome-rejected' as const,
            diagnostic: 'invalid result',
            rejectedAt: '2026-11-05T00:00:01.000Z',
          },
        },
      ],
    };
    let run = state({ execution: previous });
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
            _runId: string,
            reduce: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              value: T;
            },
          ): Promise<T> => {
            const reduced = reduce({ state: run, trajectory: [] });
            if (reduced.state) run = reduced.state;
            return Promise.resolve(reduced.value);
          },
        },
      },
    });

    await expect(
      authority.markHostNotExecuted(
        {
          runId: run.runId,
          workId: previous.workId,
          attempt: previous.attempt,
          checkEpoch: previous.checkEpoch,
          intentId: previous.intentId,
          claimToken: previous.claimToken,
          inputDigest: previous.inputDigest,
        } as never,
        'Host did not execute',
      ),
    ).rejects.toThrow(/awaiting correction/u);
    expect(run.workExecution).toEqual(previous);
  });

  it('blocks retry of a failed external side-effect Work', async () => {
    const base = checkpoint('outcome');
    const currentWork = {
      workId: base.workId,
      inputDigest: base.inputDigest,
      checkEpoch: base.checkEpoch,
      sideEffectClass: 'platform-mutation' as const,
    };
    const previous = {
      ...base,
      executionChainId: workExecutionChainIdentity(currentWork),
      retryPolicy: workExecutionRetryPolicy(currentWork),
      actionOutcome: {
        schemaVersion: 2 as const,
        outcomeId: 'outcome-failed',
        runId: 'run-recovery',
        workId: base.workId,
        attempt: base.attempt,
        checkEpoch: base.checkEpoch,
        claimToken: base.claimToken,
        inputDigest: base.inputDigest,
        status: 'failed' as const,
        summary: 'external mutation failed after dispatch',
      },
    } as WorkExecutionCheckpoint;
    let run = {
      ...state({ execution: previous }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
      changeLifecycle: { checkEpoch: currentWork.checkEpoch, currentWork, waitCondition: null },
    } as unknown as RunState;
    const packet = {
      identity: {
        schemaVersion: 1,
        packetId: digest('4'),
        packetDigest: digest('5'),
        contextDigest: digest('6'),
      },
      claim: {
        runId: run.runId,
        workId: currentWork.workId,
        attempt: 2,
        checkEpoch: currentWork.checkEpoch,
        intentId: 'intent-2',
        claimToken: digest('7'),
        inputDigest: currentWork.inputDigest,
      },
      work: currentWork,
      context: { digest: digest('6') },
    } as unknown as WorkExecutionPacket;
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
            _runId: string,
            reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              value: T;
            },
          ): Promise<T> => {
            const reduced = reduce({ state: run, trajectory: [] });
            if (reduced.state) run = reduced.state;
            return Promise.resolve(reduced.value);
          },
        },
        workExecutionPacketStore: {
          save: vi.fn().mockResolvedValue({ status: 'created', packet }),
        },
      },
    });

    await expect(recoveryAuthority(run).recovery(run.runId)).resolves.toMatchObject({
      continuation: 'wait',
      reason: 'retry-policy-blocked',
      attempt: 1,
    });
    await expect(authority.bindClaim(packet)).rejects.toThrow(/authoritative claim/u);
    expect(run.workExecution).toEqual(previous);
  });

  it('does not turn an unknown external result into a continue-build attempt', async () => {
    const previous = {
      ...checkpoint('unknown'),
      unknownKind: 'external-side-effect' as const,
      continuation: 'reconcile' as const,
    };
    const currentWork = {
      workId: 'build:1.2',
      inputDigest: previous.inputDigest,
      checkEpoch: previous.checkEpoch + 1,
    };
    let run = {
      ...state({ execution: previous }),
      stateVersion: 10,
      composition: { compositionDigest: digest('9') },
      changeLifecycle: { checkEpoch: currentWork.checkEpoch, currentWork, waitCondition: null },
    } as unknown as RunState;
    const packet = {
      identity: {
        schemaVersion: 1,
        packetId: digest('4'),
        packetDigest: digest('5'),
        contextDigest: digest('6'),
      },
      claim: {
        runId: run.runId,
        workId: currentWork.workId,
        attempt: 1,
        checkEpoch: currentWork.checkEpoch,
        intentId: 'intent-2',
        claimToken: digest('7'),
        inputDigest: currentWork.inputDigest,
      },
      work: { ...currentWork, sideEffectClass: 'platform-mutation' },
      context: { digest: digest('6') },
    } as unknown as WorkExecutionPacket;
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: <T>(
            _runId: string,
            reduce: (current: { state: RunState; trajectory: TrajectoryEvent[] }) => {
              state?: RunState;
              value: T;
            },
          ): Promise<T> => {
            const reduced = reduce({ state: run, trajectory: [] });
            if (reduced.state) run = reduced.state;
            return Promise.resolve(reduced.value);
          },
        },
        workExecutionPacketStore: {
          save: vi.fn().mockResolvedValue({ status: 'created', packet }),
        },
      },
    });

    await expect(authority.bindClaim(packet)).rejects.toThrow(/authoritative claim/u);
    expect(run.workExecution).toEqual(previous);
  });
});

describe('Managed Host reconciliation', () => {
  const invocation: WorkExecutionHostInvocation = {
    schemaVersion: 1,
    invocationId: digest('f'),
    host: {
      schemaVersion: 1,
      id: 'reconciling-host',
      version: '1',
      codeDigest: digest('1'),
      capabilities: [],
      actionKinds: ['agent'],
      reconcile: true,
    },
    packet: checkpoint('unknown').packet,
    startedAt: '2026-10-25T00:00:00.000Z',
  };

  function executor(resolution: unknown, supported = true) {
    const marks = {
      unknown: vi.fn(),
      notExecuted: vi.fn(),
      completed: vi.fn().mockResolvedValue({ status: 'submitted' }),
    };
    const host = {
      identity: invocation.host,
      preflight: vi.fn(),
      invoke: vi.fn(),
      ...(supported ? { reconcile: vi.fn().mockResolvedValue(resolution) } : {}),
    };
    const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
    Object.defineProperty(service, 'ctx', {
      value: {
        runStore: {
          loadRun: vi.fn().mockResolvedValue({
            workExecution: { ...checkpoint('unknown'), hostInvocation: invocation },
          }),
        },
        workExecutionHosts: { get: vi.fn().mockReturnValue(host) },
        workExecutionAuthority: {
          loadIntent: vi.fn().mockResolvedValue({ runId: 'run-recovery', intentId: 'intent-1' }),
          markHostUnknown: marks.unknown,
          markHostNotExecuted: marks.notExecuted,
          markHostCompleted: marks.completed,
          recordDelegationFacts: vi.fn(),
          recordSkillFacts: vi.fn(),
        },
        workDispatcher: {
          resumeClaim: vi.fn().mockResolvedValue({
            packet: { work: { kind: 'evidence.verify' }, context: { layers: [] } },
          }),
          outcome: vi.fn().mockReturnValue({}),
          acceptOutcome: vi.fn().mockResolvedValue({ validation: 'pending' }),
        },
      },
    });
    return { service, host, marks };
  }

  it('never re-invokes an unknown side effect and accepts only explicit reconciliation', async () => {
    const unsupported = executor(null, false);
    await expect(unsupported.service.reconcile('run-recovery')).resolves.toBeNull();
    expect(unsupported.host.invoke).not.toHaveBeenCalled();

    const unknown = executor({ status: 'unknown', reason: 'platform unavailable' });
    await expect(unknown.service.reconcile('run-recovery')).resolves.toBeNull();
    expect(unknown.marks.unknown).toHaveBeenCalledOnce();
    expect(unknown.host.invoke).not.toHaveBeenCalled();

    const notExecuted = executor({ status: 'not-executed', reason: 'idempotency key absent' });
    await expect(notExecuted.service.reconcile('run-recovery')).resolves.toBeNull();
    expect(notExecuted.marks.notExecuted).toHaveBeenCalledOnce();
    expect(notExecuted.host.invoke).not.toHaveBeenCalled();

    const outcome: WorkExecutionHostOutcome = {
      schemaVersion: 1,
      invocationId: invocation.invocationId,
      hostId: invocation.host.id,
      packetDigest: invocation.packet.packetDigest,
      status: 'succeeded',
      summary: 'existing side effect found',
      consumedLayerDigests: [],
      completedAt: '2026-10-25T00:01:00.000Z',
    };
    const executed = executor({ status: 'executed', outcome });
    await expect(executed.service.reconcile('run-recovery')).resolves.toMatchObject({
      hostOutcome: outcome,
      acceptance: { validation: 'pending' },
    });
    expect(executed.marks.completed).toHaveBeenCalledOnce();
    expect(executed.host.invoke).not.toHaveBeenCalled();
  });
});
