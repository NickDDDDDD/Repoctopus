import { describe, expect, it, vi } from 'vitest';

import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { WorkDispatcher } from '../services/work-dispatcher.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function work(
  kind: 'build.configure' | 'build.plan' | 'build.execute' | 'build.check',
  capabilities: readonly string[],
): WorkDescriptor {
  return {
    schemaVersion: 2,
    workId: `${kind}:work-1`,
    checkEpoch: 4,
    phase: 'build',
    kind,
    buildAction: kind.slice('build.'.length) as NonNullable<WorkDescriptor['buildAction']>,
    augmentationSkills: [],
    methodProfile: {
      id: 'method-1',
      version: '1',
      digest: digest('1'),
      sourceDigests: [],
      ruleIds: [],
    },
    capabilities,
    sideEffectClass: 'none',
    writeScopes: [],
    inputDigest: digest('2'),
    outputContract: { artifactKinds: [], trackerPublish: false },
    validatorProfile: { id: 'validator-1', version: '1', digest: digest('3') },
    authorizationSource: {
      kind: 'lifecycle-definition',
      definitionId: 'lifecycle-1',
      definitionVersion: '1',
    },
    checkpoint: `${kind}:checkpoint`,
  };
}

describe('Work-scoped Host capability authority', () => {
  it.each([
    ['build.configure', ['build.autonomous', 'repository.read', 'specification.read']],
    ['build.plan', ['build.autonomous', 'repository.read', 'specification.read']],
    [
      'build.execute',
      ['build.autonomous', 'process.execute', 'repository.read', 'repository.write'],
    ],
    ['build.check', ['build.autonomous', 'process.execute', 'repository.read']],
  ] as const)(
    'rejects an under-capable %s Host before claim, packet assembly, or invocation',
    async (kind, capabilities) => {
      const currentWork = work(kind, capabilities);
      const claim = vi.fn();
      const assemble = vi.fn();
      const recordClaimRejected = vi.fn().mockResolvedValue(undefined);
      const dispatcher = Object.create(WorkDispatcher.prototype) as WorkDispatcher;
      Object.defineProperty(dispatcher, 'contributors', { value: new Map() });
      Object.defineProperty(dispatcher, 'ctx', {
        value: {
          runStore: {
            loadRun: vi.fn().mockResolvedValue({
              runId: 'run-1',
              status: 'running',
              changeLifecycle: {
                identity: { changeId: 'change-1' },
                currentWork,
              },
            }),
          },
          actionDispatcher: { claim },
          workContextAssembler: { assemble },
          workExecutionAuthority: { recordClaimRejected },
        },
      });
      dispatcher.register({
        id: 'manual',
        identity: {
          kind: 'work',
          id: 'manual',
          version: '1',
          digest: digest('4'),
        } as never,
        requiredCapabilities: [],
      });

      await expect(
        dispatcher.claim({
          runId: 'run-1',
          adapter: 'manual',
          hostCapabilities: capabilities.slice(0, -1),
          executor: {
            actorId: 'user-1',
            runnerId: 'runner-1',
            source: 'cli',
            authenticated: true,
          },
        }),
      ).rejects.toThrow(/cannot claim/u);

      expect(recordClaimRejected).toHaveBeenCalledWith({
        runId: 'run-1',
        work: currentWork,
        attempt: 1,
        reasonCode: 'capability-required',
        missingCapabilityCount: 1,
      });
      expect(claim).not.toHaveBeenCalled();
      expect(assemble).not.toHaveBeenCalled();
    },
  );

  it('records one bounded rejection fact without creating execution ownership', async () => {
    const currentWork = work('build.execute', [
      'build.autonomous',
      'process.execute',
      'repository.read',
      'repository.write',
    ]);
    let state = {
      runId: 'run-1',
      status: 'running',
      stateVersion: 7,
      updatedAt: '2026-11-04T00:00:00.000Z',
      composition: { compositionDigest: digest('5') },
      changeLifecycle: { currentWork },
    } as unknown as RunState;
    const trajectory: TrajectoryEvent[] = [];
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: {
          commitGuarded: vi.fn(
            async <T>(
              _runId: string,
              reduce: (input: { state: RunState; trajectory: TrajectoryEvent[] }) => {
                state?: RunState;
                event?: TrajectoryEvent;
                value: T;
              },
            ): Promise<T> => {
              const result = reduce({ state, trajectory });
              if (result.state) state = result.state;
              if (result.event) trajectory.push(result.event);
              return result.value;
            },
          ),
        },
      },
    });
    Reflect.set(authority, 'flushTelemetry', vi.fn().mockResolvedValue(undefined));

    const rejection = {
      runId: 'run-1',
      work: currentWork,
      attempt: 1,
      reasonCode: 'capability-required' as const,
      missingCapabilityCount: 2,
    };
    await authority.recordClaimRejected(rejection);
    await authority.recordClaimRejected(rejection);

    expect(state.workExecution).toBeUndefined();
    expect(trajectory).toHaveLength(1);
    expect(trajectory[0]).toMatchObject({
      type: 'work.claim-rejected',
      data: {
        workKind: 'build.execute',
        result: 'blocked',
        reasonCode: 'capability-required',
        missingCapabilityCount: 2,
      },
    });
    expect(JSON.stringify(trajectory[0])).not.toMatch(/repository\.write|process\.execute/u);
  });
});
