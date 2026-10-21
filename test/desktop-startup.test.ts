import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveDesktopProductRoot } from '../app/desktop/main/product-root.js';
import { scheduleDesktopStartup } from '../app/desktop/main/startup.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Desktop Shell startup contract', () => {
  it('resolves the development product root from Repoctopus build layout', () => {
    const moduleDirectory = path.join('repoctopus', 'dist', 'desktop');
    expect(
      resolveDesktopProductRoot({
        appPath: path.join('repoctopus', 'dist', 'desktop'),
        isPackaged: false,
        moduleDirectory,
      }),
    ).toBe(path.resolve('repoctopus'));
  });

  it('uses Electron application root after packaging', () => {
    const appPath = path.join('installation', 'resources', 'app.asar');
    expect(
      resolveDesktopProductRoot({
        appPath,
        isPackaged: true,
        moduleDirectory: path.join('ignored', 'dist', 'desktop'),
      }),
    ).toBe(path.resolve(appPath));
  });

  it('registers readiness without suspending the ESM entry and reports startup failure', async () => {
    const readiness = deferred<void>();
    const start = vi.fn(() => Promise.reject(new Error('window failed')));
    const exit = vi.fn();
    const reportFailure = vi.fn();

    expect(
      scheduleDesktopStartup({ whenReady: () => readiness.promise, exit }, start, reportFailure),
    ).toBeUndefined();
    expect(start).not.toHaveBeenCalled();

    readiness.resolve();
    await vi.waitFor(() => {
      expect(reportFailure).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'window failed' }),
      );
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
