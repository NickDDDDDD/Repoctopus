import { describe, expect, it } from 'vitest';

import type { ExecutionContext } from '../domains/telemetry/execution-context.js';
import {
  projectTaskTrajectory,
  type TaskTrajectoryData,
} from '../domains/telemetry/task-trajectory.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';

const REVISION_1 = `sha256:${'1'.repeat(64)}` as const;
const REVISION_2 = `sha256:${'2'.repeat(64)}` as const;

function context(
  workId: string,
  taskId: string,
  taskRevision: `sha256:${string}`,
  checkEpoch: number,
): ExecutionContext {
  return {
    schemaVersion: 1,
    phase: 'build',
    work: { id: workId, kind: 'task.implement' },
    task: { id: taskId, revision: taskRevision },
    attempt: 1,
    checkEpoch,
  };
}

function event(
  sequence: number,
  type: Extract<TrajectoryEvent['type'], `task.${string}`>,
  data: TaskTrajectoryData,
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `event-${sequence}`,
    timestamp: `2026-10-27T00:00:0${sequence}.000Z`,
    type,
    runId: 'run-task-trajectory',
    stateVersion: sequence,
    compositionDigest: `sha256:${'a'.repeat(64)}`,
    data,
  };
}

describe('Task trajectory projection', () => {
  it('reconstructs exact multi-Task progress from Task identity and revision events', () => {
    const firstTask = { id: '1.1', revision: REVISION_1 } as const;
    const secondTask = { id: '1.2', revision: REVISION_2 } as const;
    const first = context('build:1.1', firstTask.id, firstTask.revision, 4);
    const second = context('build:1.2', secondTask.id, secondTask.revision, 6);
    const projection = projectTaskTrajectory({
      tasks: [
        { id: '1.1', revision: REVISION_1 },
        { id: '1.2', revision: REVISION_2 },
      ],
      events: [
        event(1, 'task.started', {
          schemaVersion: 1,
          task: firstTask,
          result: 'started',
          executionContext: first,
        }),
        event(2, 'task.completed', {
          schemaVersion: 1,
          task: firstTask,
          result: 'completed',
          executionContext: first,
          completion: { receiptId: 'receipt-1' },
        }),
        event(3, 'task.started', {
          schemaVersion: 1,
          task: secondTask,
          result: 'started',
          executionContext: second,
        }),
      ],
    });

    expect(projection.progress).toEqual({ total: 2, completed: 1, active: 1, pending: 0 });
    expect(projection.tasks.map(({ id, revision, status }) => ({ id, revision, status }))).toEqual([
      { id: '1.1', revision: REVISION_1, status: 'completed' },
      { id: '1.2', revision: REVISION_2, status: 'in-progress' },
    ]);
  });

  it('binds Verify to Build fallback to the original Task, Evidence, and repair Work', () => {
    const originalTask = { id: '2.1', revision: REVISION_1 } as const;
    const original = context('build:2.1', originalTask.id, originalTask.revision, 8);
    const repair = context('build:repair:2.1', originalTask.id, originalTask.revision, 11);
    const projection = projectTaskTrajectory({
      tasks: [{ id: '2.1', revision: REVISION_1 }],
      events: [
        event(1, 'task.completed', {
          schemaVersion: 1,
          task: originalTask,
          result: 'completed',
          executionContext: original,
          completion: { receiptId: 'receipt-original' },
        }),
        event(2, 'task.reopened', {
          schemaVersion: 1,
          task: originalTask,
          result: 'reopened',
          recovery: {
            kind: 'fallback',
            sourcePhase: 'verify',
            evidence: {
              attemptId: 'attempt-verify-1',
              bundleId: 'bundle-verify-1',
              inputFingerprint: `sha256:${'e'.repeat(64)}`,
            },
            continuation: {
              work: repair.work,
              task: originalTask,
              checkEpoch: repair.checkEpoch,
            },
          },
        }),
      ],
    });

    expect(projection.tasks[0]?.status).toBe('reopened');
    expect(projection.reworkChains).toEqual([
      expect.objectContaining({
        task: originalTask,
        sourcePhase: 'verify',
        attemptId: 'attempt-verify-1',
        bundleId: 'bundle-verify-1',
        nextWorkId: 'build:repair:2.1',
        nextCheckEpoch: 11,
      }),
    ]);
  });

  it('binds Archive to Design fallback to every superseded Task, Evidence, and planning Work', () => {
    const designWork = { id: 'design:replan', kind: 'specification.plan' } as const;
    const evidenceIds = ['archive-input', 'closure-receipt', 'planning-digest'];
    const events = [REVISION_1, REVISION_2].flatMap((revision, index) => {
      const task = { id: `3.${index + 1}`, revision };
      return [
        event(index * 2 + 1, 'task.completed', {
          schemaVersion: 1,
          task,
          result: 'completed',
          executionContext: context(`build:${task.id}`, task.id, revision, index + 2),
          completion: { receiptId: `receipt-${task.id}` },
        }),
        event(index * 2 + 2, 'task.reopened', {
          schemaVersion: 1,
          task,
          result: 'reopened',
          recovery: {
            kind: 'fallback',
            sourcePhase: 'archive',
            evidence: { ids: evidenceIds },
            continuation: { work: designWork, checkEpoch: 20 },
          },
        }),
      ];
    });
    const projection = projectTaskTrajectory({
      tasks: [
        { id: '3.1', revision: REVISION_1 },
        { id: '3.2', revision: REVISION_2 },
      ],
      events,
    });

    expect(projection.progress).toEqual({ total: 2, completed: 0, active: 0, pending: 2 });
    expect(projection.reworkChains).toHaveLength(2);
    expect(projection.reworkChains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePhase: 'archive',
          evidenceIds,
          nextWorkId: designWork.id,
          nextCheckEpoch: 20,
        }),
      ]),
    );
  });
});
