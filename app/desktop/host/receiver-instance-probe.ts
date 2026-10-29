import { Service, type Context } from '@deepseek-ai/cordis';

import type { DesktopInstanceProbe } from '../shared/instance-probe.js';
import { DesktopReceiverDiscovery } from './receiver-discovery.js';

export interface DesktopReceiverInstanceProbeConfig {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Host adapter for the neutral instance-probe port consumed by the project Launcher. */
export class DesktopReceiverInstanceProbe extends Service implements DesktopInstanceProbe {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;

  constructor(context: Context, config: DesktopReceiverInstanceProbeConfig = {}) {
    super(context, 'desktopInstanceProbe');
    this.environment = config.environment ?? process.env;
    this.platform = config.platform ?? process.platform;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const discovery = new DesktopReceiverDiscovery({
        environment: this.environment,
        platform: this.platform,
      });
      return (await discovery.discover()).status === 'available';
    } catch {
      return false;
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopInstanceProbe: DesktopReceiverInstanceProbe;
  }
}
