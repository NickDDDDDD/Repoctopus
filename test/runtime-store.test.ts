import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import {
  FileRuntimeStore,
  TrajectoryCorruptionError,
  type RuntimeStoreHooks,
} from '../platform/runtime/file-runtime-store.js';
import {
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function startedEvent(runId: string, stateVersion: number): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence: 1,
    eventId: `${runId}-started`,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'run.started',
    runId,
    stateVersion,
    data: {},
  };
}

describe.each<keyof RuntimeStoreHooks>([
  'afterJournalWritten',
  'afterTrajectoryWritten',
  'afterRunWritten',
  'afterCheckpointWritten',
])('runtime store recovery at %s', (hookName) => {
  it('completes exactly one durable transition after a crash', async () => {
    const workspace = await temporaryDirectory('repoctopus-store-');
    cleanup.push(workspace);
    const workflow = workflowFixture();
    const project = projectFixture();
    const state = startRun({
      workflow,
      runId: `run-${hookName}`,
      projectSnapshotDigest: project.digest,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const hooks: RuntimeStoreHooks = {
      [hookName]: () => {
        throw new Error(`crash:${hookName}`);
      },
    };
    const crashing = new FileRuntimeStore(workspace, hooks);
    await expect(
      crashing.initialize({
        state,
        workflow,
        projectSnapshot: project,
        event: startedEvent(state.runId, 0),
      }),
    ).rejects.toThrow(`crash:${hookName}`);
    expect((await crashing.inspect(state.runId)).pendingTransition).toBe(true);

    const recovered = new FileRuntimeStore(workspace);
    expect(await recovered.recover(state.runId)).toBe(true);
    expect(await recovered.recover(state.runId)).toBe(false);
    expect(await recovered.loadRun(state.runId)).toEqual(state);
    expect(await recovered.loadTrajectory(state.runId)).toHaveLength(1);
    expect((await recovered.loadCheckpoint(state.runId)).trajectoryOffset).toBe(1);
  });
});

describe('runtime store corruption detection', () => {
  it('rejects a truncated trajectory instead of silently discarding it', async () => {
    const workspace = await temporaryDirectory('repoctopus-corruption-');
    cleanup.push(workspace);
    const workflow = workflowFixture();
    const project = projectFixture();
    const state = startRun({
      workflow,
      runId: 'run-corruption',
      projectSnapshotDigest: project.digest,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const store = new FileRuntimeStore(workspace);
    await store.initialize({
      state,
      workflow,
      projectSnapshot: project,
      event: startedEvent(state.runId, 0),
    });
    const paths = store.paths(state.runId);
    const trajectory = await readFile(paths.trajectory, 'utf8');
    await writeFile(paths.trajectory, trajectory.trimEnd());
    await expect(store.loadTrajectory(state.runId)).rejects.toBeInstanceOf(
      TrajectoryCorruptionError,
    );
  });

  it('rejects stale versions and cross-run events', async () => {
    const workspace = await temporaryDirectory('repoctopus-store-guard-');
    cleanup.push(workspace);
    const workflow = workflowFixture();
    const project = projectFixture();
    const state = startRun({
      workflow,
      runId: 'run-store-guard',
      projectSnapshotDigest: project.digest,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const store = new FileRuntimeStore(workspace);
    await store.initialize({
      state,
      workflow,
      projectSnapshot: project,
      event: startedEvent(state.runId, 0),
    });
    const nextState = { ...state, stateVersion: 1, updatedAt: '2026-01-01T00:00:01.000Z' };
    const nextEvent: TrajectoryEvent = {
      ...startedEvent(state.runId, 1),
      sequence: 2,
      eventId: 'event-next',
      type: 'run.resumed',
    };
    await expect(
      store.commit({ state: nextState, event: nextEvent, previousStateVersion: 9 }),
    ).rejects.toThrow(/stale stateVersion/i);
    await expect(
      store.commit({
        state: nextState,
        event: { ...nextEvent, runId: 'run-somewhere-else' },
        previousStateVersion: 0,
      }),
    ).rejects.toThrow(/cross-run/i);

    await writeFile(
      store.paths(state.runId).transitionLock,
      `${JSON.stringify({ schemaVersion: 1, pid: 999_999, createdAt: '2000-01-01T00:00:00.000Z' })}\n`,
    );
    await store.commit({ state: nextState, event: nextEvent, previousStateVersion: 0 });
    await expect(readFile(store.paths(state.runId).transitionLock, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
