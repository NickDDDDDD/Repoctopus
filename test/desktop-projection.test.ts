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
});
