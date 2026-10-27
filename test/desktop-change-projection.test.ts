import { describe, expect, it } from 'vitest';

import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionObservation,
} from '../domains/telemetry/change-projection.js';

const base = (
  sequence: number,
  eventName: ChangeProjectionObservation['eventName'],
  overrides: Partial<ChangeProjectionObservation> = {},
): ChangeProjectionObservation => ({
  schemaVersion: 1,
  sequence,
  eventId: `event-${sequence}`,
  eventName,
  observedAt: `2026-10-27T06:${String(sequence).padStart(2, '0')}:00.000Z`,
  workspaceId: 'workspace-a',
  changeId: 'change-a',
  runId: 'run-a',
  workflowName: 'repoctopus-change',
  phase: null,
  work: null,
  skill: null,
  result: null,
  ...overrides,
});

function project(records: readonly ChangeProjectionObservation[]) {
  return records.reduce(
    (snapshot, observation) => reduceChangeProjection(snapshot, observation).snapshot,
    createEmptyChangeProjection(),
  );
}

const records = [
  base(1, 'change.phase.entered', { phase: 'open' }),
  base(2, 'change.phase.completed', { phase: 'open', result: 'succeeded' }),
  base(3, 'change.phase.entered', { phase: 'design' }),
  base(4, 'work.created', {
    phase: 'design',
    work: { id: 'design-work', kind: 'specification.plan', attempt: 1 },
  }),
  base(5, 'skill.resolved', {
    phase: 'design',
    work: { id: 'design-work', kind: 'specification.plan', attempt: 1 },
    skill: { name: 'repoctopus-design-change', role: 'action' },
  }),
  base(6, 'skill.delivered', {
    phase: 'design',
    work: { id: 'design-work', kind: 'specification.plan', attempt: 1 },
    skill: { name: 'repoctopus-design-change', role: 'action' },
  }),
  base(7, 'skill.consumed', {
    phase: 'design',
    work: { id: 'design-work', kind: 'specification.plan', attempt: 1 },
    skill: { name: 'repoctopus-design-change', role: 'action' },
    result: 'accepted',
  }),
] as const;

describe('desktop change projection reducer', () => {
  it('converges for ordered, shuffled and duplicate delivery', () => {
    const ordered = project(records);
    const shuffled = project([
      records[6],
      records[2],
      records[0],
      records[4],
      records[1],
      records[3],
      records[5],
      records[6],
      records[0],
    ]);

    expect(shuffled).toEqual(ordered);
    expect(ordered).toMatchObject({
      schemaVersion: 1,
      version: 7,
      activeChange: { workspaceId: 'workspace-a', changeId: 'change-a' },
      freshness: { status: 'fresh', headSequence: 7, missingSequences: [] },
    });
    expect(ordered.changes[0]?.runs[0]).toMatchObject({
      runId: 'run-a',
      currentPhase: 'design',
      phases: [
        { phase: 'open', status: 'completed' },
        { phase: 'design', status: 'running' },
        { phase: 'build', status: 'not-started' },
        { phase: 'verify', status: 'not-started' },
        { phase: 'archive', status: 'not-started' },
      ],
      currentWork: {
        id: 'design-work',
        kind: 'specification.plan',
        attempt: 1,
        status: 'active',
        skills: [
          {
            name: 'repoctopus-design-change',
            role: 'action',
            status: 'consumed',
          },
        ],
      },
    });
  });

  it('marks a missing sequence as a gap without inferring omitted phase completion', () => {
    const incomplete = project([records[0], records[2]]);

    expect(incomplete.freshness).toMatchObject({
      status: 'gap',
      headSequence: 3,
      missingSequences: [2],
    });
    expect(incomplete.changes[0]?.runs[0]?.phases).toEqual([
      expect.objectContaining({ phase: 'open', status: 'running' }),
      expect.objectContaining({ phase: 'design', status: 'running' }),
      expect.objectContaining({ phase: 'build', status: 'not-started' }),
      expect.objectContaining({ phase: 'verify', status: 'not-started' }),
      expect.objectContaining({ phase: 'archive', status: 'not-started' }),
    ]);

    const repaired = reduceChangeProjection(incomplete, records[1]).snapshot;
    expect(repaired.freshness.status).toBe('fresh');
    expect(repaired.changes[0]?.runs[0]?.phases[0]?.status).toBe('completed');
  });

  it('rejects one stable event identity reused for different content', () => {
    const initial = project([records[0]]);
    const collision = { ...records[0], phase: 'archive' as const };
    expect(() => reduceChangeProjection(initial, collision)).toThrow(/identity collision/iu);
  });

  it('rejects two event identities claiming one authoritative sequence', () => {
    const initial = project([records[0]]);
    const collision = { ...records[0], eventId: 'different-event' };
    expect(() => reduceChangeProjection(initial, collision)).toThrow(/sequence collision/iu);
  });

  it('selects the deterministically latest active change rather than the latest arrival', () => {
    const later = base(8, 'change.phase.entered', {
      eventId: 'event-change-b',
      workspaceId: 'workspace-b',
      changeId: 'change-b',
      runId: 'run-b',
      phase: 'build',
    });
    const snapshot = project([later, ...records]);
    expect(snapshot.activeChange).toEqual({ workspaceId: 'workspace-b', changeId: 'change-b' });
    expect(snapshot.changes.map((change) => change.changeId)).toEqual(['change-a', 'change-b']);
  });
});
