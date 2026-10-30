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
  it.each([
    ['claimed', 'execute', 'claim-redelivery'],
    ['context-delivered', 'execute', 'claim-redelivery'],
    ['unknown', 'reconcile', 'host-result-unknown'],
    ['not-executed', 'execute', 'host-not-executed'],
    ['submitted', 'execute', 'validator-pending'],
    ['validated', 'execute', 'transition-pending'],
  ] as const)('classifies %s without guessing completion', async (status, continuation, reason) => {
    await expect(
      recoveryAuthority(state({ execution: checkpoint(status) })).recovery('run-recovery'),
    ).resolves.toMatchObject({ continuation, reason, workId: 'build:1.1', attempt: 1 });
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
