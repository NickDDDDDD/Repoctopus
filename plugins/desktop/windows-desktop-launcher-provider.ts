import type { Context } from '@deepseek-ai/cordis';

import type { DesktopRunContext } from '../../app/desktop/shared/activation-protocol.js';
import { WindowsDesktopLauncher } from '../../platform/desktop/windows-launcher.js';
import {
  DesktopLauncher,
  type DesktopActivationResult,
} from '../../services/desktop-runtime.js';

export interface WindowsDesktopLauncherConfig {
  productRoot: string;
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
}

export class WindowsDesktopLauncherProvider extends DesktopLauncher {
  private readonly launcher: WindowsDesktopLauncher;

  constructor(context: Context, config: WindowsDesktopLauncherConfig) {
    super(context);
    this.launcher = new WindowsDesktopLauncher(config);
  }

  activate(context: DesktopRunContext): Promise<DesktopActivationResult> {
    return this.launcher.activate(context);
  }
}
