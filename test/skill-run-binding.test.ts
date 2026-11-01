import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { RunState } from '../domains/engine/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import type {
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';
import {
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function workspaceFixture(): Promise<string> {
  const workspace = await temporaryDirectory('repoctopus-skill-run-');
  cleanup.push(workspace);
  await writeFile(
    path.join(workspace, 'repoctopus.yaml'),
    JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'skill-run', repositoryId: 'workspace' },
      repositories: [{ id: 'workspace', path: '.' }],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'noop',
              type: 'command',
              repository: 'workspace',
              executable: process.execPath,
              args: ['-e', 'process.exit(0)'],
            },
          ],
        },
      ],
    }),
  );
  return workspace;
}

async function writeSkill(workspace: string, name: string, body: string): Promise<void> {
  const directory = path.join(workspace, '.agents', 'skills', name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} override\n---\n\n${body}\n`,
  );
}

describe('Skill snapshots bound to a Run', () => {
  it('ignores unused Skill changes and blocks a used Skill drift on resume', async () => {
    const workspace = await workspaceFixture();
    let app = await bootProjectComposition(productRoot, workspace);
    await app.context.workflowRuns.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({ root: workspace }),
      runId: 'skill-bound-run',
    });
    await app.context.commandRouter.execute('skill.get', {
      cwd: workspace,
      audience: 'user',
      name: 'tdd',
      runId: 'skill-bound-run',
    });
    await app.close();

    await writeSkill(workspace, 'unused-skill', 'This Skill is not used by the Run.');
    app = await bootProjectComposition(productRoot, workspace);
    const advanced = await app.context.workflowRuns.next('skill-bound-run');
    expect(advanced.value.state.status).toBe('waiting');
    expect(advanced.value.skillCompatibility?.status).toBe('same');
    await app.close();

    await writeSkill(workspace, 'tdd', 'Changed TDD method.');
    app = await bootProjectComposition(productRoot, workspace);
    const status = await app.context.workflowRuns.status('skill-bound-run');
    expect(status.skillCompatibility).toMatchObject({
      status: 'drifted',
      changedSkills: ['tdd'],
    });
    const resumed = await app.context.workflowRuns.resume({
      runId: 'skill-bound-run',
      currentProjectSnapshot: projectFixture({ root: workspace }),
    });
    expect(resumed).toMatchObject({
      diagnostics: [{ level: 'error', code: 'runtime.migration-required' }],
      value: {
        execution: { continuation: 'reconcile', reason: 'content-missing-or-corrupt' },
        skillCompatibility: { status: 'drifted', changedSkills: ['tdd'] },
        state: { stateVersion: status.state.stateVersion },
      },
    });
    await app.close();
  });
});

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function measurementPacket(): WorkExecutionPacket {
  return {
    schemaVersion: 2,
    identity: {
      schemaVersion: 1,
      packetId: digest('1'),
      packetDigest: digest('2'),
      contextDigest: digest('3'),
    },
    claim: {
      runId: 'run-skill-measurement',
      intentId: 'intent-1',
      workId: 'build.execute:1',
      attempt: 1,
      checkEpoch: 4,
      claimToken: digest('4'),
      inputDigest: digest('5'),
      compositionDigest: digest('6'),
    },
    work: {
      workId: 'build.execute:1',
      kind: 'build.execute',
      phase: 'build',
      packageId: 'package-1',
    },
    hostRequirement: {
      schemaVersion: 1,
      actionKind: 'agent',
      capabilities: ['repository.write'],
      sideEffectClass: 'repository-write',
    },
    context: {
      layers: [
        {
          kind: 'action-skill',
          source: 'repoctopus-build-task',
          content: 'execute',
          digest: digest('7'),
          skillRole: 'action',
        },
        {
          kind: 'augmentation-skill',
          source: 'team-tdd',
          content: 'test first',
          digest: digest('8'),
          skillRole: 'team-guidance',
        },
      ],
    },
  } as unknown as WorkExecutionPacket;
}

function measurementOutcome(): WorkExecutionHostOutcome {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    hostId: 'host-1',
    packetDigest: digest('2'),
    status: 'succeeded',
    summary: 'done',
    consumedLayerDigests: [digest('7'), digest('8')],
    result: { schemaVersion: 1, kind: 'implementation-result', artifacts: [] },
    completedAt: '2026-11-02T00:00:01.000Z',
  } as unknown as WorkExecutionHostOutcome;
}

function measurementHarness() {
  let state = {
    runId: 'run-skill-measurement',
    status: 'running',
    stateVersion: 1,
    updatedAt: '2026-11-02T00:00:00.000Z',
    composition: { compositionDigest: digest('6') },
    changeLifecycle: {
      checkEpoch: 4,
      currentWork: { workId: 'build.execute:1', kind: 'build.execute' },
    },
    workExecution: {
      schemaVersion: 3,
      workId: 'build.execute:1',
      attempt: 1,
      checkEpoch: 4,
      intentId: 'intent-1',
      claimToken: digest('4'),
      inputDigest: digest('5'),
      packet: {
        schemaVersion: 1,
        packetId: digest('1'),
        packetDigest: digest('2'),
        contextDigest: digest('3'),
      },
      status: 'invoking',
      continuation: 'execute',
      updatedAt: '2026-11-02T00:00:00.000Z',
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

describe('Skill-to-Work measurement binding', () => {
  it('persists only consumed layers against the same Work attempt and Host invocation', async () => {
    const { authority, trajectory } = measurementHarness();
    const packet = measurementPacket();

    await authority.recordSkillFacts(packet, 'resolved');
    await authority.recordSkillFacts(packet, 'delivered');
    await authority.recordSkillFacts(packet, 'consumed', [digest('8')], 'invocation-1');

    const consumed = trajectory().filter((event) => event.type === 'skill.consumed');
    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toMatchObject({
      data: {
        workId: 'build.execute:1',
        attempt: 1,
        invocationId: 'invocation-1',
        skillName: 'team-tdd',
        skillCategory: 'team',
        result: 'consumed',
      },
    });
  });

  it('records additive, replay-safe outcomes without inferring from nearby events', async () => {
    const { authority, trajectory } = measurementHarness();
    const packet = measurementPacket();
    const outcome = measurementOutcome();

    await authority.recordSkillOutcomeFacts(packet, outcome, 'completed', 'outcome-1');
    await authority.recordSkillOutcomeFacts(packet, outcome, 'completed', 'outcome-1');
    await authority.recordSkillOutcomeFacts(
      packet,
      outcome,
      'corrected',
      'repair-1',
      'repair-work',
    );

    const facts = trajectory().filter((event) => event.type === 'skill.outcome-recorded');
    expect(facts).toHaveLength(4);
    expect(facts.map((event) => event.data.result)).toEqual([
      'completed',
      'completed',
      'corrected',
      'corrected',
    ]);
    expect(facts.every((event) => event.data.invocationId === 'invocation-1')).toBe(true);
    expect(new Set(facts.map((event) => event.eventId)).size).toBe(4);
    expect(
      facts
        .filter((event) => event.data.result === 'corrected')
        .every((event) => event.data.correctionKind === 'repair-work'),
    ).toBe(true);
  });

  it.each(['changes-requested', 'outcome-rejection', 'task-reopen', 'repair-work'] as const)(
    'records only the bounded %s correction category',
    async (correctionKind) => {
      const { authority, trajectory } = measurementHarness();
      await authority.recordSkillOutcomeFacts(
        measurementPacket(),
        measurementOutcome(),
        'corrected',
        correctionKind,
        correctionKind,
      );

      expect(
        trajectory()
          .filter((event) => event.type === 'skill.outcome-recorded')
          .map((event) => event.data.correctionKind),
      ).toEqual([correctionKind, correctionKind]);
    },
  );
});
