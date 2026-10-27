import { describe, expect, it, vi } from 'vitest';

import { DesktopProjectionSession } from '../app/desktop/renderer/src/projection-session.js';
import type {
  DesktopShellState,
  RepoctopusDesktopBridge,
} from '../app/desktop/shared/renderer-contract.js';
import { createEmptyChangeProjection } from '../domains/telemetry/change-projection.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

function ready(version: number, deltaVersion: number | null = null): DesktopShellState {
  const projection = { ...createEmptyChangeProjection(), version };
  return {
    phase: 'ready',
    snapshot: { apiVersion: DESKTOP_APPLICATION_CONTRACT, phase: 'ready' },
    projection,
    delta:
      deltaVersion === null
        ? null
        : {
            schemaVersion: 1,
            version: deltaVersion,
            eventId: `event-${deltaVersion}`,
            workspaceId: 'workspace-a',
            changeId: 'change-a',
            freshness: projection.freshness,
          },
    launch: { sequence: 0, current: null, history: [] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Desktop Renderer projection session', () => {
  it('rejects stale deltas and resynchronizes one sequence gap with a snapshot', async () => {
    const resync = deferred<DesktopShellState>();
    const currentState = vi
      .fn<RepoctopusDesktopBridge['currentState']>()
      .mockResolvedValueOnce(ready(10))
      .mockImplementationOnce(() => resync.promise);
    let listener: ((state: DesktopShellState) => void) | undefined;
    const bridge: RepoctopusDesktopBridge = {
      currentState,
      retry: vi.fn(),
      onState: vi.fn((next: (state: DesktopShellState) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    };
    const published: DesktopShellState[] = [];
    const session = new DesktopProjectionSession(bridge, (state) => published.push(state));

    await session.start();
    expect(published.at(-1)).toMatchObject({ phase: 'ready', projection: { version: 10 } });

    listener?.(ready(9, 9));
    listener?.(ready(11, 11));
    expect(published.at(-1)).toMatchObject({ phase: 'ready', projection: { version: 11 } });

    listener?.(ready(14, 14));
    listener?.(ready(15, 15));
    expect(currentState).toHaveBeenCalledTimes(2);
    expect(published.at(-1)).toMatchObject({ phase: 'ready', projection: { version: 11 } });

    resync.resolve(ready(15));
    await session.settled();
    expect(published.at(-1)).toMatchObject({ phase: 'ready', projection: { version: 15 } });

    listener?.(ready(15, 15));
    listener?.(ready(16, 16));
    expect(published.at(-1)).toMatchObject({ phase: 'ready', projection: { version: 16 } });
    expect(currentState).toHaveBeenCalledTimes(2);

    session.stop();
  });
});
