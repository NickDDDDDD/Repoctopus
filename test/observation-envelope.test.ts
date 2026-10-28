import { describe, expect, it } from 'vitest';

import {
  createObservationEnvelope,
  type ObservationContext,
} from '../domains/trajectory/observation.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';

const context: ObservationContext = {
  workspaceId: 'team-platform',
  changeId: 'dashboard',
  workflowName: 'change-lifecycle',
  workflowVersion: '1.0.0',
};

function event(type: TrajectoryEvent['type'], data: Record<string, unknown> = {}): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence: 7,
    eventId: 'event-7',
    timestamp: '2026-10-28T00:00:07.000Z',
    type,
    runId: 'run-dashboard',
    stateVersion: 7,
    compositionDigest: `sha256:${'a'.repeat(64)}`,
    data,
  };
}

describe('ObservationEnvelope', () => {
  it('maps the same fact to one stable, canonical and allowlisted envelope', () => {
    const source = event('work.host-completed', {
      phase: 'build',
      buildAction: 'execute',
      workId: 'build.execute:7',
      workKind: 'build.execute',
      taskId: '3.1',
      packageId: 'work-package:3',
      attempt: 2,
      hostId: 'host-1',
      validatorId: 'package-validator',
      result: 'succeeded',
      continuation: 'execute',
      prompt: 'private prompt',
      body: 'private body',
      commandOutput: 'private output',
      path: 'C:\\Users\\private\\source.ts',
      token: 'secret-token',
    });

    const first = createObservationEnvelope(source, context);
    const replay = createObservationEnvelope(structuredClone(source), structuredClone(context));
    expect(replay).toEqual(first);
    expect(first.identity).toEqual({
      eventId: 'event-7',
      runId: 'run-dashboard',
      sequence: 7,
    });
    expect(first.correlation).toMatchObject({
      workspaceId: 'team-platform',
      changeId: 'dashboard',
      phase: 'build',
      buildAction: 'execute',
      workId: 'build.execute:7',
      taskId: '3.1',
      attempt: 2,
      hostId: 'host-1',
      validatorId: 'package-validator',
      continuation: 'execute',
    });
    expect(JSON.stringify(first)).not.toMatch(
      /private prompt|private body|private output|C:\\\\Users|secret-token|prompt|commandOutput/u,
    );
  });

  it('preserves absence and supports all authoritative phase/build correlations', () => {
    const phases = ['open', 'design', 'build', 'verify', 'archive'] as const;
    const actions = ['configure', 'plan', 'plan-evidence', 'execute', 'check'] as const;
    for (const phase of phases) {
      expect(
        createObservationEnvelope(event('work.created', { phase }), context).correlation.phase,
      ).toBe(phase);
    }
    for (const buildAction of actions) {
      expect(
        createObservationEnvelope(event('work.created', { phase: 'build', buildAction }), context)
          .correlation.buildAction,
      ).toBe(buildAction);
    }
    expect(createObservationEnvelope(event('run.started'), context).correlation).not.toHaveProperty(
      'phase',
    );
  });

  it('correlates execution, skill, decision, verification and recovery facts without inventing fields', () => {
    const fixtures: Array<[TrajectoryEvent['type'], Record<string, unknown>, string]> = [
      ['work.claimed', { workId: 'work-1', workKind: 'build.execute', attempt: 2 }, 'workId'],
      ['work.created', { taskId: '3.2', taskRevision: 'revision-1' }, 'taskId'],
      ['work.host-started', { hostId: 'host-1' }, 'hostId'],
      ['validator.completed', { validatorId: 'validator-1' }, 'validatorId'],
      ['continuation.selected', { continuation: 'reconcile' }, 'continuation'],
      ['skill.resolved', { skillName: 'tdd', skillRole: 'augmentation' }, 'skillName'],
      ['wait.started', { waitId: 'decision-1', waitKind: 'human-decision' }, 'decisionId'],
      ['action.completed', { evidenceAttemptId: 'verify-attempt-1' }, 'evidenceAttemptId'],
      ['recovery.reconciled', {}, 'recovery'],
    ];
    for (const [type, data, key] of fixtures) {
      expect(createObservationEnvelope(event(type, data), context).correlation).toHaveProperty(key);
    }
    expect(createObservationEnvelope(event('run.resumed'), context).correlation).not.toHaveProperty(
      'workId',
    );
  });
});
