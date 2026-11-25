import { Service, type Context } from '@deepseek-ai/cordis';

import type { DesktopInstanceProbe } from '../shared/instance-probe.js';
import type { DesktopReceiverConnection } from '../../../services/desktop-receiver.js';
import { DesktopReceiverDiscovery } from './receiver-discovery.js';

export interface DesktopReceiverInstanceProbeConfig {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** Host adapter for the neutral instance-probe port consumed by the project Launcher. */
export class DesktopReceiverInstanceProbe extends Service implements DesktopInstanceProbe {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private validated?: { connection: DesktopReceiverConnection; expiresAt: number };
  private resolving: Promise<DesktopReceiverConnection | null> | undefined;

  constructor(context: Context, config: DesktopReceiverInstanceProbeConfig = {}) {
    super(context, 'desktopInstanceProbe');
    this.environment = config.environment ?? process.env;
    this.platform = config.platform ?? process.platform;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.connection()) !== null;
  }

  async connection(): Promise<DesktopReceiverConnection | null> {
    if (this.validated && Date.now() < this.validated.expiresAt) return this.validated.connection;
    this.resolving ??= this.discoverConnection().finally(() => {
      this.resolving = undefined;
    });
    return this.resolving;
  }

  private async discoverConnection(): Promise<DesktopReceiverConnection | null> {
    try {
      const discovery = new DesktopReceiverDiscovery({
        environment: this.environment,
        platform: this.platform,
      });
      const result = await discovery.discover();
      if (result.status !== 'available') return null;
      this.validated = { connection: result.connection, expiresAt: Date.now() + 5_000 };
      return result.connection;
    } catch {
      return null;
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopInstanceProbe: DesktopReceiverInstanceProbe;
  }
}
