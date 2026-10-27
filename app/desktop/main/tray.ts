export interface DesktopTrayMenuItem {
  id?: 'open' | 'quit';
  label?: string;
  type?: 'separator';
  click?: () => void;
}

export interface DesktopTrayHandle {
  on(event: 'click', listener: () => void): void;
  setToolTip(value: string): void;
  setContextMenu(menu: unknown): void;
  destroy(): void;
}

export interface DesktopTrayOptions {
  handle: DesktopTrayHandle;
  buildMenu(template: DesktopTrayMenuItem[]): unknown;
  open(): void;
  quit(): void;
}

/** Process-lifetime Windows tray with one restore path and one unconditional full-exit path. */
export class DesktopTray {
  private handle: DesktopTrayHandle | undefined;

  constructor(private readonly options: DesktopTrayOptions) {
    this.handle = options.handle;
    options.handle.on('click', () => options.open());
    options.handle.setToolTip('Repoctopus Dashboard');
    options.handle.setContextMenu(
      options.buildMenu([
        { id: 'open', label: '打开 Dashboard', click: () => options.open() },
        { type: 'separator' },
        { id: 'quit', label: '完全退出', click: () => options.quit() },
      ]),
    );
  }

  dispose(): void {
    const handle = this.handle;
    this.handle = undefined;
    handle?.destroy();
  }
}
