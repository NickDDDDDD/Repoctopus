import { describe, expect, it, vi } from 'vitest';

import {
  DesktopBackendController,
  type DesktopBackendHost,
  type DesktopBackendState,
} from '../app/desktop/main/backend-controller.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('DesktopBackendController', () => {
  it('shares concurrent startup and exposes only the ready host', async () => {
    const readiness = deferred<void>();
    const stop = vi.fn(() => Promise.resolve());
    const host: DesktopBackendHost = { start: () => readiness.promise, stop };
    const states: DesktopBackendState[] = [];
    const controller = new DesktopBackendController(
      () => host,
      (state) => states.push(state),
    );

    const first = controller.start(() => Promise.resolve());
    const second = controller.start(() => Promise.resolve());
    expect(second).toBe(first);
    expect(controller.host).toBeUndefined();

    readiness.resolve();
    await first;
    expect(controller.host).toBe(host);
    expect(states.map((state) => state.phase)).toEqual(['starting', 'ready']);

    await controller.close();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps the Shell recoverable when a ready Host fails', async () => {
    let fail!: (error: Error) => void;
    const stop = vi.fn(() => Promise.resolve());
    const states: DesktopBackendState[] = [];
    const controller = new DesktopBackendController(
      (onFailure) => {
        fail = onFailure;
        return { start: () => Promise.resolve(), stop };
      },
      (state) => states.push(state),
    );

    await controller.start(() => Promise.resolve());
    fail(new Error('receiver crashed'));
    await vi.waitFor(() => {
      expect(controller.state).toMatchObject({ phase: 'error', message: 'receiver crashed' });
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(states.map((state) => state.phase)).toEqual(['starting', 'ready', 'error']);
  });

  it('serializes a retry after a ready Host fails and exposes only the replacement', async () => {
    const stops = [vi.fn(() => Promise.resolve()), vi.fn(() => Promise.resolve())];
    const failures: Array<(error: Error) => void> = [];
    const hosts: DesktopBackendHost[] = stops.map((stop) => ({
      start: () => Promise.resolve(),
      stop,
    }));
    let created = 0;
    const controller = new DesktopBackendController((onFailure) => {
      failures.push(onFailure);
      return hosts[created++]!;
    }, () => undefined);

    await controller.start(() => Promise.resolve());
    expect(controller.host).toBe(hosts[0]);
    failures[0]!(new Error('first Host failed'));
    await vi.waitFor(() => expect(controller.state.phase).toBe('error'));

    await controller.stop();
    await controller.start(() => Promise.resolve());
    expect(controller.host).toBe(hosts[1]);
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).not.toHaveBeenCalled();

    await controller.close();
    expect(stops[1]).toHaveBeenCalledOnce();
  });

  it('does not spawn a Host after close cancels pending preparation', async () => {
    const preparation = deferred<void>();
    const createHost = vi.fn(() => ({
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    }));
    const controller = new DesktopBackendController(createHost, () => undefined);

    const start = controller.start(() => preparation.promise);
    const close = controller.close();
    preparation.resolve();
    await Promise.all([start, close]);
    expect(createHost).not.toHaveBeenCalled();
  });
});
