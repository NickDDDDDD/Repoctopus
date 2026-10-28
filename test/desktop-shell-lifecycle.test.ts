import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DesktopShellLifecycle,
  type DesktopCloseDecision,
} from '../app/desktop/main/shell-lifecycle.js';
import { DesktopShellSettingsStore } from '../app/desktop/main/shell-settings.js';
import {
  DesktopTray,
  type DesktopTrayHandle,
  type DesktopTrayMenuItem,
} from '../app/desktop/main/tray.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe('desktop close lifecycle', () => {
  it('persists only validated user-level close preferences and fails closed to ask', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-shell-'));
    roots.push(root);
    const store = new DesktopShellSettingsStore(root);
    expect(store.read().closePreference).toBe('ask');
    store.writeClosePreference('tray');
    expect(new DesktopShellSettingsStore(root).read().closePreference).toBe('tray');
    await writeFile(store.filePath, '{"schemaVersion":1,"closePreference":"forever"}');
    expect(store.read().closePreference).toBe('ask');
    expect(await readFile(store.filePath, 'utf8')).toContain('forever');
  });

  it.each(['quit', 'tray'] as const)('applies stored %s without asking', async (preference) => {
    const ask = vi.fn<() => Promise<DesktopCloseDecision>>();
    const hideWindow = vi.fn();
    const stopBackend = vi.fn(() => Promise.resolve());
    const quitApplication = vi.fn();
    const lifecycle = new DesktopShellLifecycle({
      readPreference: () => preference,
      writePreference: vi.fn(),
      ask,
      hideWindow,
      showWindow: vi.fn(),
      stopBackend,
      quitApplication,
      disposeTray: vi.fn(),
    });
    await lifecycle.requestWindowClose();
    expect(ask).not.toHaveBeenCalled();
    expect(preference === 'tray' ? hideWindow : stopBackend).toHaveBeenCalledOnce();
    if (preference === 'quit') expect(quitApplication).toHaveBeenCalledOnce();
  });

  it('coalesces ask decisions and makes tray/session full exit share one shutdown', async () => {
    let resolve!: (decision: DesktopCloseDecision) => void;
    const answer = new Promise<DesktopCloseDecision>((accept) => {
      resolve = accept;
    });
    const stopBackend = vi.fn(() => Promise.resolve());
    const lifecycle = new DesktopShellLifecycle({
      readPreference: () => 'ask',
      writePreference: vi.fn(),
      ask: () => answer,
      hideWindow: vi.fn(),
      showWindow: vi.fn(),
      stopBackend,
      quitApplication: vi.fn(),
      disposeTray: vi.fn(),
    });
    const first = lifecycle.requestWindowClose();
    expect(lifecycle.requestWindowClose()).toBe(first);
    resolve({ action: 'cancel', remember: false });
    await first;
    expect(lifecycle.requestFullQuit('tray')).toBe(lifecycle.requestFullQuit('session'));
    await lifecycle.requestFullQuit('tray');
    expect(stopBackend).toHaveBeenCalledOnce();
  });

  it('restores from tray click/menu and exposes one explicit full exit', () => {
    class FakeTray implements DesktopTrayHandle {
      destroy = vi.fn();
      setContextMenu = vi.fn();
      setToolTip = vi.fn();
      click?: () => void;
      on(_event: 'click', listener: () => void) {
        this.click = listener;
      }
    }
    const handle = new FakeTray();
    const open = vi.fn();
    const quit = vi.fn();
    const tray = new DesktopTray({
      handle,
      open,
      quit,
      buildMenu: (items: DesktopTrayMenuItem[]) => items,
    });
    handle.click?.();
    const menu = handle.setContextMenu.mock.calls[0]![0] as DesktopTrayMenuItem[];
    menu.find((item) => item.id === 'open')?.click?.();
    menu.find((item) => item.id === 'quit')?.click?.();
    tray.dispose();
    tray.dispose();
    expect(open).toHaveBeenCalledTimes(2);
    expect(quit).toHaveBeenCalledOnce();
    expect(handle.destroy).toHaveBeenCalledOnce();
  });
});
