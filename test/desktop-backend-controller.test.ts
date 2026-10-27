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

    await controller.stop();
    await controller.start(() => Promise.resolve());
    expect(controller.state.phase).toBe('ready');
    expect(states.map((state) => state.phase)).toEqual([
      'starting',
      'ready',
      'error',
      'starting',
      'starting',
      'ready',
    ]);
    await controller.close();
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

  it('waits for crashed Host cleanup before sharing one retry Host', async () => {
    const firstStopped = deferred<void>();
    let fail!: (error: Error) => void;
    const first = {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => firstStopped.promise),
    };
    const second = {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
    };
    const createHost = vi
      .fn<(onFailure: (error: Error) => void) => DesktopBackendHost>()
      .mockImplementationOnce((onFailure) => {
        fail = onFailure;
        return first;
      })
      .mockImplementationOnce(() => second);
    const controller = new DesktopBackendController(createHost, () => undefined);

    await controller.start(() => Promise.resolve());
    fail(new Error('Host crashed'));
    await vi.waitFor(() => expect(first.stop).toHaveBeenCalledOnce());

    const stopping = controller.stop();
    await expect(controller.start(() => Promise.resolve())).rejects.toThrow(
      'desktop backend is stopping',
    );
    firstStopped.resolve();
    await stopping;

    const firstRetry = controller.start(() => Promise.resolve());
    const secondRetry = controller.start(() => Promise.resolve());
    expect(secondRetry).toBe(firstRetry);
    await firstRetry;

    expect(createHost).toHaveBeenCalledTimes(2);
    expect(second.start).toHaveBeenCalledOnce();
    await controller.close();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});
