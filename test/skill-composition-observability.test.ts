import { describe, expect, it } from 'vitest';

import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import type { WorkExecutionPacket } from '../domains/work-execution/types.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function harness() {
  let state = {
    runId: 'run-team-skill-observability',
    status: 'running',
    stateVersion: 1,
    updatedAt: '2026-10-31T00:00:00.000Z',
    composition: { compositionDigest: digest('a') },
    changeLifecycle: {
      skillCompositionDigest: digest('b'),
      checkEpoch: 3,
      currentWork: { workId: 'specification.plan:1', kind: 'specification.plan' },
    },
    workExecution: {
      schemaVersion: 3,
      workId: 'specification.plan:1',
      attempt: 1,
      checkEpoch: 3,
      intentId: 'intent-1',
      claimToken: digest('c'),
      inputDigest: digest('d'),
      packet: {
        schemaVersion: 1,
        packetId: digest('e'),
        packetDigest: digest('f'),
        contextDigest: digest('0'),
      },
      status: 'invoking',
      continuation: 'wait',
      updatedAt: '2026-10-31T00:00:00.000Z',
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
  return { authority, trajectory: () => trajectory };
}

describe('team Skill composition observability', () => {
  it('persists bounded reject and drift facts against the frozen composition', async () => {
    const { authority, trajectory } = harness();

    await authority.recordSkillCompositionRejected(
      'run-team-skill-observability',
      'contract-invalid',
    );
    await authority.recordSkillCompositionDrift('run-team-skill-observability', 2);

    expect(trajectory().map(({ type }) => type)).toEqual([
      'skill-composition.rejected',
      'skill-composition.drifted',
    ]);
    expect(trajectory().map(({ data }) => data)).toEqual([
      expect.objectContaining({
        skillCompositionDigest: digest('b'),
        result: 'blocked',
        reasonCode: 'contract-invalid',
      }),
      expect.objectContaining({
        skillCompositionDigest: digest('b'),
        result: 'blocked',
        reasonCode: 'provider-drift',
        changedSkillCount: 2,
      }),
    ]);
  });

  it('persists a consumption failure for the affected frozen layer', async () => {
    const { authority, trajectory } = harness();
    const packet = {
      claim: {
        runId: 'run-team-skill-observability',
        intentId: 'intent-1',
        attempt: 1,
      },
      identity: { packetDigest: digest('f') },
      work: {
        workId: 'specification.plan:1',
        kind: 'specification.plan',
        phase: 'design',
        skillComposition: { digest: digest('b') },
      },
      context: {
        layers: [
          {
            kind: 'augmentation-skill',
            source: 'team-design-method',
            digest: digest('1'),
            skillRole: 'team-replacement',
            bindingId: 'team-design-replacement',
            slotId: 'design-method',
            skillOrder: 1,
            replacedSkillName: 'codebase-design',
          },
        ],
      },
    } as unknown as WorkExecutionPacket;

    await authority.recordSkillConsumptionRejected(packet, {
      invocationId: 'host-invocation-1',
      reasonCode: 'missing-layer',
      missingLayerDigests: [digest('1')],
      unknownLayerDigests: [],
    });

    expect(trajectory()).toHaveLength(1);
    expect(trajectory()[0]).toMatchObject({
      type: 'skill.consumption-rejected',
      data: {
        invocationId: 'host-invocation-1',
        skillName: 'team-design-method',
        skillRole: 'team-replacement',
        bindingId: 'team-design-replacement',
        slotId: 'design-method',
        skillOrder: 1,
        replacedSkillName: 'codebase-design',
        result: 'failed',
        reasonCode: 'missing-layer',
      },
    });
  });
});
