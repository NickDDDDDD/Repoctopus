import { describe, expect, it, vi } from 'vitest';

import type { ActionIntent } from '../domains/action/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import type { WorkExecutionPacket } from '../domains/work-execution/types.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';

const packetDigest = `sha256:${'a'.repeat(64)}` as const;

function fixture() {
  const executor = {
    actorId: 'user',
    runnerId: 'runner',
    source: 'cli' as const,
    authenticated: true,
  };
  const hostId = 'external:cli:runner';
  const scope = {
    intentId: 'intent',
    runId: 'run',
    workId: 'work',
    attempt: 1,
    checkEpoch: 2,
    inputDigest: 'input',
  };
  const invocation = {
    invocationId: 'parent',
    packet: { packetDigest },
    executor,
    host: { id: hostId, capabilities: ['subagent.dispatch.attested'] },
  };
  const packet = {
    identity: { packetDigest, contextDigest: 'context' },
    claim: scope,
    work: { ...scope, kind: 'build.execute', phase: 'build', packageId: 'pkg' },
    context: { digest: 'context' },
  } as unknown as WorkExecutionPacket;
  let state = {
    ...scope,
    status: 'running',
    stateVersion: 1,
    composition: { compositionDigest: 'composition' },
    changeLifecycle: {
      ...scope,
      currentWork: packet.work,
      buildProtocol: {
        strategy: { executionMode: 'subagent-driven-development' },
        plan: { packages: [{ packageId: 'pkg', taskIds: ['1.1'], repositoryIds: ['frontend'] }] },
      },
    },
    workExecution: {
      ...scope,
      status: 'invoking',
      packet: { packetDigest },
      hostInvocation: invocation,
    },
  } as unknown as RunState;
  const trajectory: TrajectoryEvent[] = [];
  const service = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
  Object.defineProperty(service, 'ctx', {
    value: {
      runStore: {
        commitGuarded: (
          _runId: string,
          operation: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
            state?: RunState;
            event?: TrajectoryEvent;
            value: unknown;
          },
        ) => {
          const result = operation({ state, trajectory });
          if (result.state && result.event) {
            state = result.state;
            trajectory.push(result.event);
          }
          return Promise.resolve(result.value);
        },
        loadRun: vi.fn().mockRejectedValue(new Error('offline telemetry fixture')),
      },
    },
  });
  vi.spyOn(service, 'loadAuthoritativePacket').mockResolvedValue({
    intent: scope as ActionIntent,
    packet,
  });
  const input = {
    runId: 'run',
    invocationId: 'parent',
    packetDigest,
    hostId,
    executor,
    activity: {
      executionId: 'child',
      stage: 'started',
      role: 'implementer',
      repositoryId: 'frontend',
      taskId: '1.1',
    },
  };
  return { service, input, trajectory, state: () => state };
}

describe('managed child Agent activity', () => {
  it('records real boundaries idempotently without changing the execution checkpoint', async () => {
    const { service, input, trajectory, state } = fixture();
    const checkpoint = state().workExecution;
    await expect(service.recordExternalDelegationActivity(input)).resolves.toEqual({
      status: 'recorded',
    });
    await expect(service.recordExternalDelegationActivity(input)).resolves.toEqual({
      status: 'duplicate',
    });
    await expect(
      service.recordExternalDelegationActivity({
        ...input,
        activity: { ...input.activity, stage: 'returned' },
      }),
    ).resolves.toEqual({ status: 'recorded' });
    await expect(
      service.recordExternalDelegationActivity({
        ...input,
        activity: { ...input.activity, stage: 'verifying' },
      }),
    ).rejects.toThrow(/already advanced/u);
    expect(trajectory.map(({ type }) => type)).toEqual([
      'delegation.activity',
      'delegation.activity',
    ]);
    expect(state().workExecution).toEqual(checkpoint);
  });

  it('rejects wrong owners, assignments, and superseded claims before recording', async () => {
    const { service, input, trajectory, state } = fixture();
    await expect(
      service.recordExternalDelegationActivity({
        ...input,
        executor: { ...input.executor, actorId: 'other-user' },
      }),
    ).rejects.toThrow(/active invocation/u);
    await expect(
      service.recordExternalDelegationActivity({
        ...input,
        activity: { ...input.activity, repositoryId: 'backend' },
      }),
    ).rejects.toThrow(/current Work Package/u);
    state().workExecution!.status = 'submitted';
    await expect(service.recordExternalDelegationActivity(input)).rejects.toThrow(
      /active invocation/u,
    );
    expect(trajectory).toEqual([]);
  });
});
