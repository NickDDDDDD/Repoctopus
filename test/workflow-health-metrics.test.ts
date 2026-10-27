import { describe, expect, it } from 'vitest';

import type { RunState } from '../domains/engine/types.js';
import {
  projectWorkflowHealthMetrics,
  type WorkflowHealthMetricSample,
} from '../domains/telemetry/workflow-health-metrics.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';
import { startRun } from '../domains/engine/loop.js';

const composition = compositionFixture();

function event(
  sequence: number,
  timestampSeconds: number,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `event-${sequence}`,
    timestamp: `2026-01-01T00:00:${String(timestampSeconds).padStart(2, '0')}.000Z`,
    type,
    runId: 'run-health',
    stateVersion: sequence,
    compositionDigest: composition.compositionDigest,
    data,
  };
}

const executionContext = {
  schemaVersion: 1,
  phase: 'design',
  work: { id: 'design:work-1', kind: 'specification.plan' },
  attempt: 2,
  checkEpoch: 4,
};

function samplesFor(
  trajectory: readonly TrajectoryEvent[],
  runOverrides: Partial<RunState> = {},
): WorkflowHealthMetricSample[] {
  const workflow = workflowFixture();
  const project = projectFixture();
  const run = {
    ...startRun({
      workflow,
      runId: 'run-health',
      projectSnapshotDigest: project.digest,
      composition,
      timestamp: '2026-01-01T00:00:00.000Z',
    }),
    ...runOverrides,
  };
  return trajectory.flatMap((candidate) =>
    projectWorkflowHealthMetrics({ run, trajectory, event: candidate }),
  );
}

describe('workflow health metric projection', () => {
  it('uses controlled event boundaries for phase, active, wait, validator, reconcile, and Run time', () => {
    const transition = (
      sequence: number,
      timestampSeconds: number,
      fromPhase: 'open' | 'design',
      toPhase: 'design' | 'build',
    ) =>
      event(sequence, timestampSeconds, 'change.lifecycle.transitioned', {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: `transition-${sequence}`,
          revision: sequence,
          from: { phase: fromPhase, status: 'running', checkEpoch: sequence - 1 },
          to: { phase: toPhase, status: 'running', checkEpoch: sequence },
        },
      });
    const trajectory = [
      event(1, 0, 'run.started', {}),
      transition(2, 5, 'open', 'design'),
      event(3, 6, 'work.claimed', { executionContext }),
      event(4, 8, 'validator.started', {
        executionContext,
        validatorId: 'design.ready',
        operationId: 'validator-operation-1',
      }),
      event(5, 11, 'validator.completed', {
        executionContext,
        validatorId: 'design.ready',
        operationId: 'validator-operation-1',
        result: 'accepted',
      }),
      event(6, 12, 'wait.started', {
        phase: 'design',
        waitId: 'wait-1',
        waitKind: 'human',
      }),
      event(7, 17, 'wait.ended', {
        phase: 'design',
        waitId: 'wait-1',
        waitKind: 'human',
        result: 'accepted',
      }),
      event(8, 19, 'work.completed', { executionContext, result: 'succeeded' }),
      event(9, 20, 'reconcile.started', {
        executionContext,
        reconcileId: 'reconcile-1',
        result: 'unknown',
      }),
      event(10, 22, 'reconcile.completed', {
        executionContext,
        reconcileId: 'reconcile-1',
        result: 'succeeded',
      }),
      transition(11, 25, 'design', 'build'),
    ];
    const samples = samplesFor(trajectory, {
      status: 'completed',
      updatedAt: '2026-01-01T00:00:25.000Z',
    });

    expect(samples.filter((sample) => sample.instrument === 'duration')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'run', durationMs: 25_000 }),
        expect.objectContaining({ kind: 'phase-residency', phase: 'open', durationMs: 5_000 }),
        expect.objectContaining({ kind: 'phase-residency', phase: 'design', durationMs: 20_000 }),
        expect.objectContaining({ kind: 'active-execution', phase: 'design', durationMs: 13_000 }),
        expect.objectContaining({ kind: 'human-wait', phase: 'design', durationMs: 5_000 }),
        expect.objectContaining({ kind: 'validator', phase: 'design', durationMs: 3_000 }),
        expect.objectContaining({ kind: 'reconcile', phase: 'design', durationMs: 2_000 }),
      ]),
    );
  });

  it('emits only fixed categories for rework, retry, unknown, reconcile, and recovery', () => {
    const trajectory = [
      event(1, 1, 'work.claimed', { executionContext }),
      event(2, 2, 'task.reopened', {
        result: 'reopened',
        recovery: { kind: 'fallback', sourcePhase: 'verify' },
      }),
      event(3, 3, 'reconcile.started', { executionContext, result: 'unknown' }),
      event(4, 4, 'reconcile.completed', { executionContext, result: 'not-executed' }),
      event(5, 5, 'recovery.reconciled', {
        phase: 'archive',
        recoveryKind: 'resume',
        result: 'succeeded',
      }),
    ];
    const samples = samplesFor(trajectory).filter((sample) => sample.instrument === 'event');

    expect(samples.map((sample) => sample.kind)).toEqual([
      'retry',
      'rework',
      'unknown',
      'reconcile',
      'recovery',
    ]);
    expect(JSON.stringify(samples)).not.toMatch(/design:work-1|event-|validator-operation/u);
    for (const sample of samples) {
      expect(['open', 'design', 'build', 'verify', 'archive', 'unknown']).toContain(sample.phase);
      expect(['succeeded', 'failed', 'accepted', 'rejected', 'unknown', 'reopened', 'not-executed']).toContain(
        sample.result,
      );
    }
  });
});
