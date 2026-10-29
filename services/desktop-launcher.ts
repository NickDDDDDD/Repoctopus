import { spawn } from 'node:child_process';

import { Service, type Context } from '@deepseek-ai/cordis';

import {
  desktopLaunchContextArgument,
  type DesktopLaunchContext,
} from '../app/desktop/shared/launch-context.js';

export interface DesktopLaunchResult {
  status: 'started' | 'unavailable';
  warning?: string;
}

/** Best-effort application boundary: launcher failure is observability loss, never workflow failure. */
export class DesktopLauncher extends Service {
  constructor(
    context: Context,
    private readonly config: { environment?: NodeJS.ProcessEnv } = {},
  ) {
    super(context, 'desktopLauncher');
  }

  activate(launchContext: DesktopLaunchContext): DesktopLaunchResult {
    const environment = this.config.environment ?? process.env;
    const executable = environment.REPOCTOPUS_DESKTOP_EXECUTABLE?.trim();
    if (!executable) {
      return { status: 'unavailable', warning: 'Repoctopus Desktop executable is not configured' };
    }
    try {
      const child = spawn(executable, [desktopLaunchContextArgument(launchContext)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { status: 'started' };
    } catch (error) {
      return {
        status: 'unavailable',
        warning: error instanceof Error ? error.message : 'Repoctopus Desktop could not start',
      };
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopLauncher: DesktopLauncher;
  }
}
