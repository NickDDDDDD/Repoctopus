import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopShellLifecycle,
  type DesktopCloseDecision,
} from '../app/desktop/main/shell-lifecycle.js';
import { DesktopShellSettingsStore } from '../app/desktop/main/shell-settings.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function settingsStore(): Promise<{
  root: string;
  store: DesktopShellSettingsStore;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-shell-settings-'));
  temporaryRoots.push(root);
  return { root, store: new DesktopShellSettingsStore(root) };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accepted) => {
    resolve = accepted;
  });
  return { promise, resolve };
}

describe('Desktop shell settings', () => {
  it('defaults to ask and atomically persists only a validated user-level close preference', async () => {
    const { root, store } = await settingsStore();

    expect(store.read()).toEqual({ schemaVersion: 1, closePreference: 'ask' });
    store.writeClosePreference('tray');

    expect(new DesktopShellSettingsStore(root).read()).toEqual({
      schemaVersion: 1,
      closePreference: 'tray',
    });
    expect(JSON.parse(await readFile(path.join(root, 'desktop', 'settings.json'), 'utf8'))).toEqual(
      { schemaVersion: 1, closePreference: 'tray' },
    );
  });

  it('fails closed to ask when the user-level document is malformed', async () => {
    const { root, store } = await settingsStore();
    const settingsPath = path.join(root, 'desktop', 'settings.json');
    store.writeClosePreference('quit');
    await writeFile(settingsPath, '{"schemaVersion":1,"closePreference":"forever"}\n');

    expect(store.read()).toEqual({ schemaVersion: 1, closePreference: 'ask' });
  });
});

describe('Desktop shell lifecycle', () => {
  function fixture(
    options: {
      preference?: 'ask' | 'quit' | 'tray';
      decision?: DesktopCloseDecision | Promise<DesktopCloseDecision>;
    } = {},
  ) {
    let preference = options.preference ?? 'ask';
    const hide = vi.fn();
    const show = vi.fn();
    const stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const quit = vi.fn();
    const disposeTray = vi.fn();
    const ask = vi.fn(
      async (): Promise<DesktopCloseDecision> =>
        Promise.resolve(
          options.decision ??
            ({ action: 'cancel', remember: false } satisfies DesktopCloseDecision),
        ),
    );
    const lifecycle = new DesktopShellLifecycle({
      readPreference: () => preference,
      writePreference: (next) => {
        preference = next;
      },
      ask,
      hideWindow: hide,
      showWindow: show,
      stopBackend: stop,
      quitApplication: quit,
      disposeTray,
    });
    return {
      lifecycle,
      get preference() {
        return preference;
      },
      hide,
      show,
      stop,
      quit,
      disposeTray,
      ask,
    };
  }

  it('hides for tray, fully stops for quit, and never asks for either stored preference', async () => {
    const tray = fixture({ preference: 'tray' });
    await tray.lifecycle.requestWindowClose();
    expect(tray.hide).toHaveBeenCalledOnce();
    expect(tray.stop).not.toHaveBeenCalled();
    expect(tray.ask).not.toHaveBeenCalled();

    const quit = fixture({ preference: 'quit' });
    await quit.lifecycle.requestWindowClose();
    expect(quit.stop).toHaveBeenCalledOnce();
    expect(quit.disposeTray).toHaveBeenCalledOnce();
    expect(quit.quit).toHaveBeenCalledOnce();
    expect(quit.ask).not.toHaveBeenCalled();
  });

  it('applies an ask decision once, remembers only quit or tray, and coalesces repeated closes', async () => {
    const answer = deferred<DesktopCloseDecision>();
    const shell = fixture({ decision: answer.promise });

    const first = shell.lifecycle.requestWindowClose();
    const second = shell.lifecycle.requestWindowClose();
    expect(second).toBe(first);
    expect(shell.ask).toHaveBeenCalledOnce();

    answer.resolve({ action: 'tray', remember: true });
    await first;
    expect(shell.preference).toBe('tray');
    expect(shell.hide).toHaveBeenCalledOnce();
  });

  it('restores from the tray while running and fences activation after shutdown starts', async () => {
    const stopping = deferred<void>();
    const shell = fixture({ preference: 'tray' });
    shell.stop.mockReturnValue(stopping.promise);

    shell.lifecycle.activateWindow();
    const shutdown = shell.lifecycle.requestFullQuit('tray');
    shell.lifecycle.activateWindow();

    expect(shell.show).toHaveBeenCalledOnce();
    expect(shell.lifecycle.isQuitting).toBe(true);
    stopping.resolve();
    await shutdown;
    expect(shell.quit).toHaveBeenCalledOnce();
  });

  it('makes tray full exit and Windows session exit bypass ask and share one bounded shutdown', async () => {
    const stopping = deferred<void>();
    const shell = fixture({ preference: 'ask' });
    shell.stop.mockReturnValue(stopping.promise);

    const trayExit = shell.lifecycle.requestFullQuit('tray');
    const sessionExit = shell.lifecycle.requestFullQuit('session');
    expect(sessionExit).toBe(trayExit);
    expect(shell.ask).not.toHaveBeenCalled();
    expect(shell.stop).toHaveBeenCalledOnce();

    stopping.resolve();
    await trayExit;
    expect(shell.disposeTray).toHaveBeenCalledOnce();
    expect(shell.quit).toHaveBeenCalledOnce();
  });
});
