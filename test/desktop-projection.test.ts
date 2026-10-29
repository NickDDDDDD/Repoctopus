import { describe, expect, it } from 'vitest';

import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
} from '../domains/trajectory/projection.js';

function observation(
  sequence: number,
  overrides: Partial<ObservationEnvelope> = {},
): ObservationEnvelope {
  return {
    schemaVersion: 1,
    envelopeId: `sha256:${String(sequence).padStart(64, '0')}`,
    digest: `sha256:${String(sequence + 100).padStart(64, '0')}`,
    observedAt: `2026-10-28T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    eventType: 'work.created',
    identity: { eventId: `event-${sequence}`, runId: 'run-1', sequence },
    correlation: {
      workspaceId: 'team-platform',
      changeId: 'dashboard',
      phase: 'build',
      buildAction: 'execute',
      workId: 'work-1',
      taskId: '3.5',
      attempt: 1,
    },
    attributes: {},
    ...overrides,
  };
}

describe('desktop change projection', () => {
  it('converges for duplicate/out-of-order delivery and reports sequence gaps', () => {
    let snapshot = createEmptyChangeProjection();
    for (const item of [observation(2), observation(2), observation(1), observation(4)]) {
      snapshot = reduceChangeProjection(snapshot, item).snapshot;
    }
    expect(snapshot.version).toBe(3);
    expect(snapshot.changes).toHaveLength(1);
    expect(snapshot.changes[0]).toMatchObject({
      workspaceId: 'team-platform',
      changeId: 'dashboard',
      runId: 'run-1',
      phase: 'build',
      buildAction: 'execute',
      latestSequence: 4,
    });
    expect(snapshot.freshness).toEqual({ status: 'gap', missing: [3] });

    const restarted = structuredClone(snapshot);
    const recovered = reduceChangeProjection(restarted, observation(3));
    expect(recovered.snapshot.freshness).toEqual({ status: 'live', missing: [] });
    expect(recovered.delta?.previousVersion).toBe(3);
    expect(recovered.delta?.version).toBe(4);
  });

  it('projects the complete semantic dashboard read model without renderer inference', () => {
    const facts: ObservationEnvelope[] = [
      observation(1, {
        eventType: 'change.lifecycle.transitioned',
        correlation: { workspaceId: 'team-platform', changeId: 'dashboard', phase: 'open' },
        attributes: {
          transitionId: 'open.started',
          fromPhase: 'open',
          fromStatus: 'running',
          toStatus: 'running',
        },
      }),
      observation(2, {
        eventType: 'change.lifecycle.transitioned',
        correlation: { workspaceId: 'team-platform', changeId: 'dashboard', phase: 'design' },
        attributes: {
          transitionId: 'design.started',
          fromPhase: 'open',
          fromStatus: 'running',
          toStatus: 'running',
        },
      }),
      observation(3, {
        eventType: 'work.host-started',
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'dashboard',
          phase: 'build',
          buildAction: 'execute',
          workId: 'build.execute:dashboard',
          workKind: 'build.execute',
          packageId: 'work-package:dashboard',
          taskId: '5.1',
          attempt: 2,
          hostId: 'external:cli:codex-root',
          validatorId: 'build.package-valid',
          continuation: 'wait',
        },
        attributes: { result: 'running' },
      }),
      ...(['resolved', 'delivered', 'consumed'] as const).map((skillState, offset) =>
        observation(4 + offset, {
          eventType: `skill.${skillState}`,
          correlation: {
            workspaceId: 'team-platform',
            changeId: 'dashboard',
            phase: 'build',
            buildAction: 'execute',
            workId: 'build.execute:dashboard',
            attempt: 2,
            skillName: 'tdd',
            skillRole: 'augmentation',
          },
          attributes: { skillState, result: 'succeeded' },
        }),
      ),
      observation(7, {
        eventType: 'wait.started',
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'dashboard',
          phase: 'build',
          workId: 'build.execute:dashboard',
          decisionId: 'decision:dashboard',
          decisionKind: 'human-decision',
        },
        attributes: { status: 'waiting' },
      }),
      observation(8, {
        eventType: 'evidence.artifact.recorded',
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'dashboard',
          phase: 'verify',
          evidenceAttemptId: 'evidence:dashboard',
          artifactId: `sha256:${'a'.repeat(64)}`,
          gateId: 'gate:dashboard',
        },
        attributes: {
          artifactType: 'verification-report',
          artifactSize: 512,
          mediaType: 'text/markdown',
          redacted: true,
          gateStatus: 'failed',
        },
      }),
      observation(9, {
        eventType: 'change.lifecycle.transitioned',
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'dashboard',
          phase: 'build',
          buildAction: 'plan',
          packageId: 'work-package:dashboard',
        },
        attributes: {
          observationKind: 'build-fallback-applied',
          findingKind: 'implementation_failure',
          fromPhase: 'verify',
          fromStatus: 'running',
          toStatus: 'running',
        },
      }),
      observation(10, {
        eventType: 'telemetry.destination.health',
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'dashboard',
          destinationId: 'remote',
        },
        attributes: {
          destinationMode: 'enabled',
          backlog: 7,
          oldestAgeMs: 30_000,
          destinationResult: 'failed',
          warningCode: 'timeout',
        },
      }),
    ];

    const snapshot = facts.reduce(
      (current, item) => reduceChangeProjection(current, item).snapshot,
      createEmptyChangeProjection(),
    );
    const change = snapshot.changes[0]!;

    expect(change.phases.map(({ phase, state }) => [phase, state])).toEqual([
      ['open', 'completed'],
      ['design', 'running'],
      ['build', 'rework'],
      ['verify', 'rework'],
      ['archive', 'not-reported'],
    ]);
    expect(change.phases.find(({ phase }) => phase === 'build')?.attempts).toHaveLength(2);
    expect(change.buildActions.find(({ action }) => action === 'execute')).toMatchObject({
      state: 'waiting',
      attempts: [{ attempt: 2 }],
    });
    expect(change.currentWork).toMatchObject({
      workId: 'build.execute:dashboard',
      taskId: '5.1',
      attempt: 2,
      hostId: 'external:cli:codex-root',
      validatorId: 'build.package-valid',
      continuation: 'wait',
    });
    expect(change.skills).toContainEqual(
      expect.objectContaining({
        name: 'tdd',
        role: 'augmentation',
        workId: 'build.execute:dashboard',
        state: 'consumed',
      }),
    );
    expect(change.decisions).toContainEqual(
      expect.objectContaining({
        decisionId: 'decision:dashboard',
        kind: 'human-decision',
        state: 'waiting',
      }),
    );
    expect(change.evidence).toContainEqual(
      expect.objectContaining({
        attemptId: 'evidence:dashboard',
        gateId: 'gate:dashboard',
        gateStatus: 'failed',
        artifacts: [
          expect.objectContaining({
            artifactId: `sha256:${'a'.repeat(64)}`,
            artifactType: 'verification-report',
            redacted: true,
          }),
        ],
      }),
    );
    expect(change.recoveries).toContainEqual(
      expect.objectContaining({
        kind: 'fallback',
        findingKind: 'implementation_failure',
        fromPhase: 'verify',
        toPhase: 'build',
      }),
    );
    expect(change.destinations).toContainEqual(
      expect.objectContaining({
        destinationId: 'remote',
        backlog: 7,
        oldestAgeMs: 30_000,
        lastResult: 'failed',
      }),
    );
    expect(change.health.transition.status).toBe('attention');
    expect(change.health.execution.status).toBe('attention');
    expect(change.health.quality.status).toBe('critical');
    expect(change.health.telemetry.status).toBe('attention');
    expect(change.health.telemetry.reasons).toContainEqual(
      expect.objectContaining({ code: 'destination-backlog' }),
    );
    expect(change.displayState).toBe('waiting');
    expect(JSON.stringify(change)).not.toMatch(/prompt|C:\\|source code|command output/iu);
  });

  it.each([
    ['sparse', 'work.created', 1, {}, { phase: 'build' }],
    ['catching-up', 'telemetry.destination.health', 1, { freshness: 'catching-up' }, {}],
    ['live', 'work.host-started', 1, { result: 'running' }, { phase: 'build', workId: 'work-1' }],
    ['stale', 'telemetry.freshness', 1, { freshness: 'stale' }, {}],
    ['error', 'telemetry.receiver.error', 1, { status: 'error' }, {}],
    [
      'waiting',
      'wait.started',
      1,
      { status: 'waiting' },
      { phase: 'design', decisionId: 'decision-1', decisionKind: 'human-decision' },
    ],
    [
      'rework',
      'change.lifecycle.transitioned',
      1,
      { observationKind: 'build-fallback-applied', fromPhase: 'verify', toStatus: 'running' },
      { phase: 'build' },
    ],
    [
      'complete',
      'change.lifecycle.transitioned',
      1,
      { fromPhase: 'archive', toStatus: 'completed' },
      { phase: 'archive' },
    ],
    [
      'failed',
      'change.lifecycle.transitioned',
      1,
      { fromPhase: 'build', toStatus: 'failed' },
      { phase: 'build' },
    ],
  ] as const)(
    'represents the %s dashboard state from explicit facts',
    (displayState, eventType, sequence, attributes, correlation) => {
      const next = observation(sequence, {
        eventType,
        attributes,
        correlation: {
          workspaceId: 'team-platform',
          changeId: `change-${displayState}`,
          ...correlation,
        },
      });
      const snapshot = reduceChangeProjection(createEmptyChangeProjection(), next).snapshot;
      expect(snapshot.changes[0]?.displayState).toBe(displayState);
    },
  );

  it('represents sequence gaps and stalled work independently', () => {
    let gap = reduceChangeProjection(createEmptyChangeProjection(), observation(1)).snapshot;
    gap = reduceChangeProjection(gap, observation(3)).snapshot;
    expect(gap.changes[0]?.displayState).toBe('gap');

    let stalled = reduceChangeProjection(
      createEmptyChangeProjection(),
      observation(1, {
        eventType: 'work.host-started',
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'stalled',
          phase: 'build',
          workId: 'work-stalled',
          attempt: 1,
          hostId: 'host-1',
        },
      }),
    ).snapshot;
    stalled = reduceChangeProjection(
      stalled,
      observation(2, {
        observedAt: '2026-10-28T00:20:00.000Z',
        eventType: 'telemetry.heartbeat',
        correlation: { workspaceId: 'team-platform', changeId: 'stalled' },
      }),
    ).snapshot;
    expect(stalled.changes[0]?.displayState).toBe('stalled');
    expect(stalled.changes[0]?.health.execution.reasons).toContainEqual(
      expect.objectContaining({ code: 'work-stalled', workId: 'work-stalled' }),
    );
  });
});
