import { describe, expect, it, vi } from 'vitest';

import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import type {
  WorkExecutionCheckpoint,
  WorkExecutionHostInvocation,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { ManagedWorkExecutor } from '../services/managed-work-executor.js';
import { WorkDispatcher } from '../services/work-dispatcher.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';

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

    await authority.markExternalSideEffectUnknown(intent, 'merge request response unavailable');
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
    const run = state({ execution: checkpoint('outcome') });
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

  it('reconciles a superseded checkpoint once before the next protected pull', async () => {
    let run = {
      ...state({ execution: checkpoint('outcome') }),
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

  it('accepts a higher attempt when Runtime reissues the same semantic Work in a newer epoch', async () => {
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
        attempt: previous.attempt + 2,
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
      attempt: 3,
      checkEpoch: 5,
      status: 'claimed',
    });
    expect(run.workExecution).toMatchObject({ intentId: 'intent-2', checkEpoch: 5 });
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
