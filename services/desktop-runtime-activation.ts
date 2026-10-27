import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { DesktopLaunchContext, DesktopLauncher } from '../domains/desktop/launcher.js';
import { WindowsDesktopProcessLauncher } from '../platform/desktop/windows-desktop-process-launcher.js';
import { DesktopRunActivation, type DesktopRunActivationResult } from './desktop-run-activation.js';

export interface DesktopRuntimeActivationConfig {
  enabled?: boolean;
  productRoot?: string;
  executable?: string;
  prefixArguments?: readonly string[];
  platform?: NodeJS.Platform;
  launcher?: DesktopLauncher;
}

function defaultLauncher(config: DesktopRuntimeActivationConfig): DesktopLauncher {
  const productRoot = path.resolve(config.productRoot ?? process.cwd());
  return new WindowsDesktopProcessLauncher({
    executable:
      config.executable ??
      path.join(productRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    prefixArguments: config.prefixArguments ?? [
      path.join(productRoot, 'dist', 'desktop', 'main.js'),
    ],
    ...(config.platform === undefined ? {} : { platform: config.platform }),
  });
}

/** Owns Runtime-to-Shell activation while keeping workflow execution non-blocking. */
export class DesktopRuntimeActivation extends Service {
  static inject = ['desktopDestination'];

  private readonly enabled: boolean;
  private readonly activation: DesktopRunActivation | null;

  constructor(context: Context, config: DesktopRuntimeActivationConfig = {}) {
    super(context, 'desktopRunActivation');
    this.enabled = config.enabled ?? true;
    this.activation = this.enabled
      ? new DesktopRunActivation(config.launcher ?? defaultLauncher(config), (launchContext) => {
          context.desktopDestination.wake(launchContext);
          return Promise.resolve();
        })
      : null;
  }

  beforeRun(context: DesktopLaunchContext): Promise<DesktopRunActivationResult> {
    if (!this.enabled || this.activation === null) {
      return Promise.resolve({ status: 'disabled', diagnostics: [] });
    }
    return this.activation.beforeRun(context);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopRunActivation: DesktopRuntimeActivation;
  }

  interface Events {
    'repoctopus/desktop-before-change-run'(
      context: DesktopLaunchContext,
    ): DesktopRunActivationResult | Promise<DesktopRunActivationResult>;
  }
}
