import { describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import { projectSkillMeasurements } from '../domains/telemetry/measurements.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

function event(
  sequence: number,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `skill-binding-${sequence}`,
    timestamp: `2026-11-02T00:00:0${sequence}.000Z`,
    type,
    runId: 'run-skill-binding',
    stateVersion: sequence,
    compositionDigest: compositionFixture().compositionDigest,
    data,
  };
}

function batch(events: TrajectoryEvent[], trajectory: TrajectoryEvent[]): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  return {
    run: startRun({
      workflow,
      runId: 'run-skill-binding',
      projectSnapshotDigest: projectSnapshot.digest,
      composition: compositionFixture(),
      timestamp: '2026-11-02T00:00:00.000Z',
    }),
    workflow,
    projectSnapshot,
    events,
    trajectory,
  };
}

describe('Skill-to-Work measurement binding', () => {
  it('counts only a consumed receipt bound to the same Work attempt and invocation', () => {
    const resolved = event(1, 'skill.resolved', { workId: 'work-1', attempt: 1, skillName: 'tdd' });
    const delivered = event(2, 'skill.delivered', {
      workId: 'work-1',
      attempt: 1,
      skillName: 'tdd',
    });
    const consumed = event(3, 'skill.consumed', {
      workId: 'work-1',
      attempt: 1,
      invocationId: 'invoke-1',
      skillName: 'tdd',
      skillRole: 'augmentation',
      skillCategory: 'builtin',
      result: 'consumed',
    });
    const accepted = event(4, 'validator.completed', {
      workId: 'work-1',
      attempt: 1,
      result: 'accepted',
    });
    const otherAttempt = event(5, 'validator.completed', {
      workId: 'work-1',
      attempt: 2,
      result: 'accepted',
    });
    const trajectory = [resolved, delivered, consumed, accepted, otherAttempt];

    expect(projectSkillMeasurements(batch([resolved, delivered], trajectory))).toEqual([]);
    expect(projectSkillMeasurements(batch([accepted], trajectory))).toMatchObject([
      { skillId: 'tdd', invocationId: 'invoke-1', result: 'completed' },
    ]);
    expect(projectSkillMeasurements(batch([otherAttempt], trajectory))).toEqual([]);
  });

  it('uses stable additive identities for rejection and formal repair without free text', () => {
    const consumed = event(1, 'skill.consumed', {
      workId: 'work-1',
      attempt: 1,
      invocationId: 'invoke-1',
      skillName: 'team-review',
      skillRole: 'augmentation',
      skillCategory: 'team',
      result: 'consumed',
    });
    const rejected = event(2, 'validator.completed', {
      workId: 'work-1',
      attempt: 1,
      result: 'rejected',
      reason: 'private reviewer text',
    });
    const corrected = event(3, 'change.lifecycle.transitioned', {
      changeLifecycleTransition: {
        transitionId: 'verify.failed',
        previousWorkId: 'work-1',
      },
      reason: 'private diff',
    });
    const trajectory = [consumed, rejected, corrected];
    const first = projectSkillMeasurements(batch([rejected, corrected], trajectory));
    const replay = projectSkillMeasurements(batch([rejected, corrected], trajectory));
    expect(first.map((item) => item.result)).toEqual(['error', 'corrected']);
    expect(first.map((item) => item.measurementId)).toEqual(
      replay.map((item) => item.measurementId),
    );
    expect(JSON.stringify(first)).not.toMatch(/reviewer|private diff/u);
  });
});
