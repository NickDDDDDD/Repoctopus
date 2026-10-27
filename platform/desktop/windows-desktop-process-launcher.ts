import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import {
  encodeDesktopLaunchContext,
  type DesktopLaunchAttempt,
  type DesktopLaunchContext,
  type DesktopLauncher,
} from '../../domains/desktop/launcher.js';

type SpawnDesktopProcess = (
  executable: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface WindowsDesktopProcessLauncherOptions {
  executable: string;
  prefixArguments?: readonly string[];
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnDesktopProcess;
}

/**
 * Starts the installed Shell or a development Electron entry. Invoking the
 * command again is also the activation protocol: Electron's single-instance
 * owner accepts the context and the short-lived second process exits.
 */
export class WindowsDesktopProcessLauncher implements DesktopLauncher {
  readonly #executable: string;
  readonly #prefixArguments: readonly string[];
  readonly #platform: NodeJS.Platform;
  readonly #spawnProcess: SpawnDesktopProcess;

  constructor(options: WindowsDesktopProcessLauncherOptions) {
    if (!options.executable.trim()) throw new Error('Desktop executable is required');
    this.#executable = options.executable;
    this.#prefixArguments = [...(options.prefixArguments ?? [])];
    this.#platform = options.platform ?? process.platform;
    this.#spawnProcess = options.spawnProcess ?? spawn;
  }

  private rejection(error: unknown): Error {
    return error instanceof Error ? error : new Error('Desktop process launch failed');
  }

  activate(context: DesktopLaunchContext): Promise<DesktopLaunchAttempt> {
    if (this.#platform !== 'win32') {
      return Promise.resolve({ status: 'unsupported', platform: this.#platform });
    }
    const arguments_ = [
      ...this.#prefixArguments,
      '--repoctopus-launch-context',
      encodeDesktopLaunchContext(context),
    ];
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.#spawnProcess(this.#executable, arguments_, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch (error) {
        reject(this.rejection(error));
        return;
      }
      const rejectError = (error: Error) => reject(error);
      child.once('error', rejectError);
      child.once('spawn', () => {
        child.removeListener('error', rejectError);
        child.unref();
        resolve({ status: 'started-or-activated' });
      });
    });
  }
}
