import { Service, type Context } from '@deepseek-ai/cordis';

import {
  normalizeDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../domains/desktop/launcher.js';

export interface DesktopLocalDestinationSnapshot {
  schemaVersion: 1;
  wakeCount: number;
  lastContext: DesktopLaunchContext | null;
}

/**
 * Runtime-side destination state for the local Desktop Dashboard. A wake is a
 * product intent rather than a direct Electron call, which keeps the process
 * adapter replaceable and gives replay a single owner.
 */
export class DesktopLocalDestination extends Service {
  private wakeCount = 0;
  private lastContext: DesktopLaunchContext | null = null;

  constructor(context: Context) {
    super(context, 'desktopDestination');
  }

  wake(context: DesktopLaunchContext): void {
    this.lastContext = normalizeDesktopLaunchContext(context);
    this.wakeCount += 1;
  }

  snapshot(): DesktopLocalDestinationSnapshot {
    return {
      schemaVersion: 1,
      wakeCount: this.wakeCount,
      lastContext: this.lastContext ? { ...this.lastContext } : null,
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopDestination: DesktopLocalDestination;
  }
}
