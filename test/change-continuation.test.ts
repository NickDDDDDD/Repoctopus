import { describe, expect, it } from 'vitest';

import {
  projectCommittedContinuation,
  projectLifecycleNextActions,
} from '../domains/change-lifecycle/continuation.js';
import type { ChangeLifecycleSnapshot } from '../domains/change-lifecycle/transition.js';
import type { Checkpoint, TrajectoryEvent } from '../domains/trajectory/types.js';

function snapshot(patch: Partial<ChangeLifecycleSnapshot>): ChangeLifecycleSnapshot {
  return {
    schemaVersion: 2,
    identity: { runId: 'run', workspaceId: 'workspace', changeId: 'change' },
    definition: {
      id: 'builtin.change-lifecycle',
      version: '1',
      digest: `sha256:${'a'.repeat(64)}`,
    },
    revision: 3,
    checkEpoch: 2,
    phase: 'build',
    status: 'running',
    currentWork: null,
    waitCondition: null,
    blocker: null,
    ...patch,
  };
}

describe('committed lifecycle continuation projector', () => {
  it('derives one deterministic Work continuation from the committed checkpoint', () => {
    const current = snapshot({
      currentWork: {
        workId: 'build.plan:abc',
        schemaVersion: 2,
        checkEpoch: 2,
        phase: 'build',
        kind: 'build.plan',
      } as ChangeLifecycleSnapshot['currentWork'],
    });
    expect(projectLifecycleNextActions(current)).toEqual([
      { id: 'build.plan:abc', kind: 'work', label: 'Run build.plan' },
    ]);
    expect(projectLifecycleNextActions(structuredClone(current))).toEqual(
      projectLifecycleNextActions(current),
    );
  });

  it('does not infer runnable work for completed or blocked checkpoints', () => {
    expect(
      projectLifecycleNextActions(snapshot({ phase: 'archive', status: 'completed' })),
    ).toEqual([]);
    expect(projectLifecycleNextActions(snapshot({ phase: 'build', status: 'blocked' }))).toEqual([
      { id: 'build.blocked', kind: 'wait', label: 'Resolve Build blocker' },
    ]);
  });

  it('replays the latest committed continuation selection without live packet or Host I/O', () => {
    const lifecycle = snapshot({
      currentWork: {
        workId: 'build.execute:abc',
        schemaVersion: 2,
        checkEpoch: 2,
        phase: 'build',
        kind: 'build.execute',
      } as ChangeLifecycleSnapshot['currentWork'],
    });
    const checkpoint = {
      schemaVersion: 1,
      runId: 'run',
      stateVersion: 9,
      trajectoryOffset: 4,
      changeLifecycle: lifecycle,
      workExecution: {
        schemaVersion: 3,
        workId: 'build.execute:abc',
        attempt: 1,
        checkEpoch: 2,
        status: 'unknown',
        continuation: 'reconcile',
      },
    } as unknown as Checkpoint;
    const trajectory: TrajectoryEvent[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        eventId: 'continuation:1',
        timestamp: '2026-11-01T00:00:00.000Z',
        type: 'continuation.selected',
        runId: 'run',
        stateVersion: 9,
        compositionDigest: `sha256:${'a'.repeat(64)}`,
        data: {
          continuation: 'reconcile',
          reason: 'host-result-unknown',
          workId: 'build.execute:abc',
          attempt: 1,
          checkEpoch: 2,
        },
      },
    ];

    expect(projectCommittedContinuation(checkpoint, trajectory)).toEqual({
      schemaVersion: 2,
      continuation: 'reconcile',
      reason: 'host-result-unknown',
      workId: 'build.execute:abc',
      attempt: 1,
      checkEpoch: 2,
    });
  });

  it('ignores a stale continuation fact after the committed Work changes', () => {
    const lifecycle = snapshot({
      checkEpoch: 3,
      currentWork: {
        workId: 'build.check:def',
        schemaVersion: 2,
        checkEpoch: 3,
        phase: 'build',
        kind: 'build.check',
      } as ChangeLifecycleSnapshot['currentWork'],
    });
    const checkpoint = {
      schemaVersion: 1,
      runId: 'run',
      stateVersion: 10,
      trajectoryOffset: 5,
      changeLifecycle: lifecycle,
    } as unknown as Checkpoint;
    const trajectory: TrajectoryEvent[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        eventId: 'continuation:1',
        timestamp: '2026-11-01T00:00:00.000Z',
        type: 'continuation.selected',
        runId: 'run',
        stateVersion: 9,
        compositionDigest: `sha256:${'a'.repeat(64)}`,
        data: {
          continuation: 'reconcile',
          reason: 'host-result-unknown',
          workId: 'build.execute:abc',
        },
      },
    ];

    expect(projectCommittedContinuation(checkpoint, trajectory)).toEqual({
      schemaVersion: 2,
      continuation: 'execute',
      reason: 'work-unclaimed',
      workId: 'build.check:def',
      attempt: null,
      checkEpoch: 3,
    });
  });
});
