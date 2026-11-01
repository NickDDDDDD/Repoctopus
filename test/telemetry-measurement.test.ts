import { describe, expect, it } from 'vitest';

import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import { createRuleEvaluationReceipt } from '../domains/telemetry/rule-evaluation.js';
import {
  projectRuleMeasurements,
  projectSkillMeasurements,
  projectWorkflowMeasurements,
} from '../domains/telemetry/measurements.js';
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
    eventId: `measurement-event-${sequence}`,
    timestamp: `2026-11-02T00:00:0${sequence}.000Z`,
    type,
    runId: 'run-measurement',
    stateVersion: sequence,
    compositionDigest: compositionFixture().compositionDigest,
    data,
  };
}

function batch(events: TrajectoryEvent[], trajectory = events): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  const base = startRun({
    workflow,
    runId: 'run-measurement',
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-11-02T00:00:00.000Z',
  });
  return {
    run: {
      ...base,
      status: 'completed',
      updatedAt: '2026-11-02T00:00:09.000Z',
      changeLifecycle: createChangeLifecycleSnapshot({
        identity: {
          workspaceId: projectSnapshot.projectId,
          changeId: 'measurement',
          runId: base.runId,
        },
      }),
    },
    workflow,
    projectSnapshot,
    events,
    trajectory,
  };
}

describe('telemetry measurements', () => {
  it('binds a consumed Skill to the same Work outcome without claiming causality', () => {
    const consumed = event(2, 'skill.consumed', {
      phase: 'build',
      workId: 'work-1',
      workKind: 'task.implement',
      attempt: 1,
      invocationId: 'invocation-1',
      skillName: 'tdd',
      skillRole: 'augmentation',
      skillCategory: 'builtin',
      result: 'consumed',
    });
    const completed = event(3, 'work.completed', {
      workId: 'work-1',
      attempt: 1,
      result: 'succeeded',
    });
    const validator = event(4, 'validator.completed', {
      workId: 'work-1',
      attempt: 1,
      result: 'accepted',
    });
    const trajectory = [event(1, 'run.started', {}), consumed, completed, validator];

    expect(
      projectSkillMeasurements(batch([consumed], trajectory)).map((item) => item.result),
    ).toEqual(['consumed']);
    expect(projectSkillMeasurements(batch([validator], trajectory))).toMatchObject([
      { result: 'completed', skillId: 'tdd', workId: 'work-1', attempt: 1 },
    ]);
    expect(projectSkillMeasurements(batch([completed], trajectory))).toEqual([]);
  });

  it('projects structured Rule receipts and keeps missing receipts unknown', () => {
    const receipt = createRuleEvaluationReceipt({
      runId: 'run-measurement',
      workId: 'work-1',
      attempt: 1,
      checkEpoch: 2,
      rule: { id: 'build.task-valid', version: '1', digest: `sha256:${'a'.repeat(64)}` },
      evaluator: { id: 'build.task-valid', version: '1' },
      applicable: true,
      expected: true,
      triggered: true,
      result: 'passed',
    });
    const evaluated = event(5, 'validator.completed', {
      workId: 'work-1',
      attempt: 1,
      result: 'accepted',
      ruleEvaluation: receipt,
    });
    expect(projectRuleMeasurements(batch([evaluated]))).toMatchObject([
      { result: 'expected', ruleId: 'build.task-valid' },
      { result: 'triggered', ruleId: 'build.task-valid' },
      { result: 'passed', ruleId: 'build.task-valid' },
    ]);
    expect(
      projectRuleMeasurements(
        batch([event(6, 'validator.completed', { workId: 'work-1', result: 'accepted' })]),
      ),
    ).toEqual([]);
  });

  it('emits one logical start and terminal workflow fact with an authoritative duration', () => {
    const started = event(1, 'run.started', {});
    const terminal = event(9, 'change.lifecycle.transitioned', {
      changeLifecycleTransition: {
        schemaVersion: 2,
        transitionId: 'archive.completed',
        definition: createChangeLifecycleSnapshot({
          identity: { workspaceId: 'workspace', changeId: 'measurement', runId: 'run-measurement' },
        }).definition,
        revision: 9,
        from: { phase: 'archive', status: 'running', checkEpoch: 8 },
        to: { phase: 'archive', status: 'completed', checkEpoch: 9 },
        workId: null,
        waitId: null,
        work: null,
        wait: null,
      },
    });
    const trajectory = [started, terminal];
    expect(projectWorkflowMeasurements(batch([started], trajectory))).toMatchObject([
      { result: 'started', durationMs: null },
    ]);
    expect(projectWorkflowMeasurements(batch([terminal], trajectory))).toMatchObject([
      { result: 'completed', durationMs: 8_000 },
    ]);
  });
});
