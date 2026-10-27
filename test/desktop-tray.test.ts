import { describe, expect, it, vi } from 'vitest';

import {
  DesktopTray,
  type DesktopTrayHandle,
  type DesktopTrayMenuItem,
} from '../app/desktop/main/tray.js';

class FakeTray implements DesktopTrayHandle {
  readonly destroy = vi.fn();
  readonly setContextMenu = vi.fn();
  readonly setToolTip = vi.fn();
  private click: (() => void) | undefined;

  on(_event: 'click', listener: () => void): void {
    this.click = listener;
  }

  activate(): void {
    this.click?.();
  }
}

describe('Desktop tray', () => {
  it('restores from click/menu and exposes an explicit full-exit action', () => {
    const handle = new FakeTray();
    const open = vi.fn();
    const quit = vi.fn();
    const buildMenu = vi.fn((template: DesktopTrayMenuItem[]): unknown => template);
    const tray = new DesktopTray({ handle, buildMenu, open, quit });

    handle.activate();
    const menu = handle.setContextMenu.mock.calls[0]![0] as Array<{
      id?: string;
      click?: () => void;
    }>;
    menu.find((item) => item.id === 'open')?.click?.();
    menu.find((item) => item.id === 'quit')?.click?.();

    expect(open).toHaveBeenCalledTimes(2);
    expect(quit).toHaveBeenCalledOnce();
    expect(handle.setToolTip).toHaveBeenCalledWith('Repoctopus Dashboard');
    tray.dispose();
    tray.dispose();
    expect(handle.destroy).toHaveBeenCalledOnce();
  });
});
