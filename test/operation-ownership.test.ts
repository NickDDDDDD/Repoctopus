import { describe, expect, it } from 'vitest';

import { OperationOwnership, ServiceDrainingError } from '../services/operation-ownership.js';

describe('operation ownership', () => {
  it('cancels safe operations, rejects new work, and drains', async () => {
    const ownership = new OperationOwnership();
    let observedAbort = false;
    const running = ownership.run({ cancellable: true }, async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
    });

    const result = await ownership.drain(1_000);
    await running;
    expect(result).toEqual({ drained: true, remaining: 0 });
    expect(observedAbort).toBe(true);
    await expect(
      ownership.run({ cancellable: true }, () => Promise.resolve(undefined)),
    ).rejects.toBeInstanceOf(ServiceDrainingError);
  });

  it('lets a durable operation drain until timeout and then aborts it for recovery', async () => {
    const ownership = new OperationOwnership();
    let release!: () => void;
    let observedAbort = false;
    const running = ownership.run(
      { cancellable: true },
      async ({ signal, markDurableBoundary }) => {
        markDurableBoundary();
        signal.addEventListener('abort', () => {
          observedAbort = true;
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );

    const firstDrain = await ownership.drain(5);
    expect(firstDrain).toEqual({ drained: false, remaining: 1 });
    expect(observedAbort).toBe(true);
    release();
    await running;
    expect(await ownership.drain(5)).toEqual({ drained: true, remaining: 0 });
  });
});
