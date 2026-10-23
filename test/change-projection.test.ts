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
      contexts: [
        {
          workspaceId: 'team-workspace',
          change: { id: 'add-windows-desktop-dashboard', status: 'active' },
          run: { id: 'run-dashboard', status: 'active' },
          stage: { name: 'verification', sequence: 3 },
        },
      ],
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

  it('retains independently selectable contexts across workspaces and changes', () => {
    const reducer = new ChangeProjectionReducer();
    reducer.accept(record(1, { stageName: 'implementation' }));
    reducer.accept(
      record(1, {
        envelopeId: `sha256:${'a'.repeat(64)}`,
        digest: `sha256:${'b'.repeat(64)}`,
        streamId: 'run-api-change',
        eventId: 'event-api-change-1',
        observedAt: '2026-10-23T08:15:04.000Z',
        workspaceId: 'api-platform',
        changeId: 'rotate-credentials',
        runId: 'run-api-change',
        stageName: 'planning',
      }),
    );
    reducer.accept(
      record(2, {
        envelopeId: `sha256:${'c'.repeat(64)}`,
        digest: `sha256:${'d'.repeat(64)}`,
        streamId: 'run-dashboard-second',
        eventId: 'event-dashboard-second-2',
        observedAt: '2026-10-23T08:15:06.000Z',
        changeId: 'harden-dashboard-navigation',
        runId: 'run-dashboard-second',
        stageName: 'verification',
      }),
    );

    expect(reducer.snapshot(liveOptions).contexts).toMatchObject([
      {
        workspaceId: 'team-workspace',
        change: { id: 'harden-dashboard-navigation' },
        run: { id: 'run-dashboard-second' },
      },
      {
        workspaceId: 'api-platform',
        change: { id: 'rotate-credentials' },
        run: { id: 'run-api-change' },
      },
      {
        workspaceId: 'team-workspace',
        change: { id: 'add-windows-desktop-dashboard' },
        run: { id: 'run-dashboard' },
      },
    ]);
  });

  it('projects current verification, safe artifacts, blockers and next actions without retaining resolved work', () => {
    const reducer = new ChangeProjectionReducer();
    reducer.accept(record(1, { eventType: 'run.started', stageName: 'verification' }));
    reducer.accept(
      record(2, {
        eventType: 'evidence.attempt.started',
        verificationId: 'attempt-current',
        verificationStatus: 'running',
        evidenceAttemptId: 'attempt-current',
      }),
    );
    reducer.accept(
      record(3, {
        eventType: 'evidence.artifact.recorded',
        verificationId: 'attempt-current',
        artifactDigest: `sha256:${'a'.repeat(64)}`,
        artifactType: 'command-stdout',
        artifactMediaType: 'text/plain; charset=utf-8',
        artifactSize: 2048,
        artifactRedacted: true,
      }),
    );
    reducer.accept(
      record(4, {
        eventType: 'evidence.gate.evaluated',
        verificationId: 'attempt-current',
        verificationStatus: 'satisfied',
        verificationOutcome: 'passed_with_warnings',
        evidenceAttemptId: 'attempt-current',
        evidenceBundleId: 'bundle-current',
        evidenceGateStatus: 'satisfied',
      }),
    );
    reducer.accept(
      record(5, {
        eventType: 'action.proposed',
        taskId: 'decision-current',
        taskStatus: 'blocked',
        blockerCategory: 'human-decision',
        blockerRequestId: 'decision-current',
        nextActionId: 'decision-current',
        nextActionType: 'ask_user',
        nextActionRef: 'desktop.review-layout',
        nextActionStage: 'verification',
      }),
    );

    expect(reducer.snapshot(liveOptions).contexts[0]?.assurance).toEqual({
      verification: {
        id: 'attempt-current',
        attemptId: 'attempt-current',
        bundleId: 'bundle-current',
        status: 'satisfied',
        gateStatus: 'satisfied',
        outcome: 'passed_with_warnings',
        lastObservedAt: '2026-10-23T08:15:04.000Z',
      },
      artifacts: [
        {
          digest: `sha256:${'a'.repeat(64)}`,
          type: 'command-stdout',
          mediaType: 'text/plain; charset=utf-8',
          size: 2048,
          redacted: true,
          verificationId: 'attempt-current',
          lastObservedAt: '2026-10-23T08:15:03.000Z',
        },
      ],
      blockers: [
        {
          category: 'human-decision',
          requestId: 'decision-current',
          lastObservedAt: '2026-10-23T08:15:05.000Z',
        },
      ],
      nextActions: [
        {
          id: 'decision-current',
          type: 'ask_user',
          ref: 'desktop.review-layout',
          stageName: 'verification',
          lastObservedAt: '2026-10-23T08:15:05.000Z',
        },
      ],
    });

    reducer.accept(
      record(6, {
        eventType: 'action.completed',
        taskId: 'decision-current',
        taskStatus: 'completed',
      }),
    );
    expect(reducer.snapshot(liveOptions).contexts[0]?.assurance).toMatchObject({
      blockers: [],
      nextActions: [],
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
      contexts: [],
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
