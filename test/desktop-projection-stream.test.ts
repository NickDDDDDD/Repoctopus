import { describe, expect, it } from 'vitest';

import { DesktopProjectionStream } from '../app/desktop/renderer/src/projection-stream.js';
import type { DesktopShellState } from '../app/desktop/shared/renderer-contract.js';
import {
  DESKTOP_APPLICATION_CONTRACT,
  type DesktopApplicationSnapshot,
  type DesktopProjectionDelta,
} from '../services/desktop-application.js';

function snapshot(version: number): DesktopApplicationSnapshot {
  return {
    apiVersion: DESKTOP_APPLICATION_CONTRACT,
    phase: 'ready',
    projection: {
      schemaVersion: 1,
      version,
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
    },
    ingress: {
      receiver: {
        status: 'ready',
        acceptedBatches: version,
        acceptedRecords: version,
        rejectedRequests: 0,
        lastReceivedAt: null,
        lastDiagnosticCode: null,
        lastSignal: null,
      },
      destination: {
        id: 'desktop-local',
        health: version === 0 ? 'unknown' : 'healthy',
        deliveryGuarantee: 'at-least-once',
      },
      replay: {
        status: 'idle',
        receivedRecords: 0,
        totalRecords: 0,
        startedAt: null,
        lastCompletedAt: null,
      },
    },
  };
}

function delta(baseVersion: number, version: number): DesktopProjectionDelta {
  const next = snapshot(version);
  return {
    apiVersion: DESKTOP_APPLICATION_CONTRACT,
    baseVersion,
    version,
    projection: next.projection,
    ingress: next.ingress,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DesktopProjectionStream', () => {
  it('applies only newer contiguous deltas after a snapshot', async () => {
    const published: DesktopShellState[] = [];
    let reads = 0;
    const stream = new DesktopProjectionStream({
      currentState: () => {
        reads += 1;
        return Promise.resolve({ phase: 'ready', snapshot: snapshot(5) });
      },
      publish: (state) => published.push(state),
    });

    stream.start();
    await flush();
    stream.acceptDelta(delta(5, 6));
    stream.acceptDelta(delta(4, 5));
    stream.acceptDelta(delta(5, 6));

    expect(reads).toBe(1);
    expect(
      published.map((state) =>
        state.phase === 'ready' ? state.snapshot.projection.version : state.phase,
      ),
    ).toEqual([5, 6]);
  });

  it('uses one snapshot read to bridge a delta gap and never starts polling', async () => {
    const recovery = deferred<DesktopShellState>();
    const published: number[] = [];
    let reads = 0;
    const stream = new DesktopProjectionStream({
      currentState: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve({ phase: 'ready', snapshot: snapshot(5) })
          : recovery.promise;
      },
      publish: (state) => {
        if (state.phase === 'ready') published.push(state.snapshot.projection.version);
      },
    });

    stream.start();
    await flush();
    stream.acceptDelta(delta(7, 8));
    stream.acceptDelta(delta(8, 9));
    expect(reads).toBe(2);

    recovery.resolve({ phase: 'ready', snapshot: snapshot(8) });
    await flush();
    await flush();

    expect(published).toEqual([5, 8, 9]);
    expect(reads).toBe(2);
  });

  it('does not let a late snapshot rewind an already applied delta', async () => {
    const initial = deferred<DesktopShellState>();
    const published: number[] = [];
    const stream = new DesktopProjectionStream({
      currentState: () => initial.promise,
      publish: (state) => {
        if (state.phase === 'ready') published.push(state.snapshot.projection.version);
      },
    });

    stream.start();
    stream.acceptState({ phase: 'ready', snapshot: snapshot(6) });
    stream.acceptDelta(delta(6, 7));
    initial.resolve({ phase: 'ready', snapshot: snapshot(5) });
    await flush();

    expect(published).toEqual([6, 7]);
  });
});
