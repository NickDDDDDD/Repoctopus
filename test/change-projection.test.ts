import { describe, expect, it } from 'vitest';

import {
  ChangeProjectionReducer,
  type ObservationRecord,
} from '../domains/telemetry/change-projection.js';

function record(sequence: number, overrides: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    schemaVersion: 1,
    envelopeId: `sha256:${sequence.toString(16).padStart(64, '0')}`,
    digest: `sha256:${(sequence + 100).toString(16).padStart(64, '0')}`,
    streamId: 'run-dashboard',
    eventId: `event-${sequence}`,
    eventType: 'run.progressed',
    sequence,
    observedAt: `2026-10-23T08:15:${String(sequence).padStart(2, '0')}.000Z`,
    workspaceId: 'team-workspace',
    changeId: 'add-windows-desktop-dashboard',
    runId: 'run-dashboard',
    changeStatus: 'active',
    runStatus: 'active',
    ...overrides,
  };
}

const liveOptions = {
  now: '2026-10-23T08:15:10.000Z',
  staleAfterMs: 10_000,
};

describe('ChangeProjectionReducer', () => {
  it('converges out-of-order events and stable duplicates to one active change snapshot', () => {
    const ordered = [
      record(1, { eventType: 'run.started', stageName: 'planning' }),
      record(2, { eventType: 'stage.entered', stageName: 'implementation' }),
      record(3, { eventType: 'stage.entered', stageName: 'verification' }),
    ];
    const first = new ChangeProjectionReducer();
    const second = new ChangeProjectionReducer();
    for (const item of ordered) expect(first.accept(item)).toBe('accepted');
    for (const item of [ordered[2]!, ordered[0]!, ordered[1]!, structuredClone(ordered[1]!)]) {
      second.accept(item);
    }

    expect(second.accept(structuredClone(ordered[2]!))).toBe('duplicate');
    expect(second.snapshot(liveOptions)).toEqual(first.snapshot(liveOptions));
    expect(first.snapshot(liveOptions)).toMatchObject({
      version: 3,
      workspaceId: 'team-workspace',
      change: { id: 'add-windows-desktop-dashboard', status: 'active' },
      activeChangeId: 'add-windows-desktop-dashboard',
      run: { id: 'run-dashboard', status: 'active' },
      stage: { name: 'verification', sequence: 3 },
      latestSequence: 3,
      freshness: 'live',
      gap: { detected: false, ranges: [] },
    });
  });

  it('reports missing sequence ranges and clears them when late events arrive', () => {
    const reducer = new ChangeProjectionReducer();
    reducer.accept(record(1));
    reducer.accept(record(4, { stageName: 'verification' }));
    expect(reducer.snapshot(liveOptions).gap).toEqual({
      detected: true,
      ranges: [{ from: 2, to: 3 }],
    });

    reducer.accept(record(3, { stageName: 'implementation' }));
    expect(reducer.snapshot(liveOptions).gap).toEqual({
      detected: true,
      ranges: [{ from: 2, to: 2 }],
    });
    reducer.accept(record(2));
    expect(reducer.snapshot(liveOptions).gap).toEqual({ detected: false, ranges: [] });
    expect(reducer.snapshot(liveOptions).stage).toEqual({ name: 'verification', sequence: 4 });
  });

  it('projects terminal Run/change status and freshness only from explicit facts and time', () => {
    const reducer = new ChangeProjectionReducer();
    reducer.accept(record(1, { stageName: 'implementation' }));
    reducer.accept(
      record(2, {
        eventType: 'run.completed',
        changeStatus: 'completed',
        runStatus: 'completed',
      }),
    );
    expect(
      reducer.snapshot({ now: '2026-10-23T08:16:00.000Z', staleAfterMs: 10_000 }),
    ).toMatchObject({
      change: { status: 'completed' },
      activeChangeId: null,
      run: { status: 'completed' },
      stage: { name: 'implementation', sequence: 1 },
      freshness: 'stale',
    });
  });

  it('rejects conflicting duplicate identities and sequence ownership', () => {
    const reducer = new ChangeProjectionReducer();
    reducer.accept(record(1));
    expect(() => reducer.accept(record(1, { runStatus: 'failed' }))).toThrow(
      /conflicting observation event/iu,
    );
    expect(() => reducer.accept(record(1, { eventId: 'another-event' }))).toThrow(
      /conflicting observation sequence/iu,
    );
  });

  it('returns an explicit empty snapshot before any records arrive', () => {
    expect(new ChangeProjectionReducer().snapshot(liveOptions)).toEqual({
      schemaVersion: 1,
      version: 0,
      workspaceId: null,
      change: null,
      activeChangeId: null,
      run: null,
      stage: null,
      latestSequence: null,
      lastObservedAt: null,
      freshness: 'empty',
      gap: { detected: false, ranges: [] },
    });
  });
});
