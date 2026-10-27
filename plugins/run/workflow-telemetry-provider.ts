import type { Context } from '@deepseek-ai/cordis';

import type { TelemetryBatch, TelemetryPort } from '../../domains/runtime/types.js';
import {
  remoteTelemetryEnabled,
  desktopAutostartEnabled,
} from '../../platform/telemetry/environment-configuration.js';
import { WindowsDesktopReceiverDiscovery } from '../../platform/desktop/windows-receiver-discovery.js';
import {
  CanonicalOtlpJsonExporter,
  IsolatedTelemetryFanout,
} from '../../platform/telemetry/canonical-otlp-json-exporter.js';
import { telemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/exporter.js';
import { WorkflowTelemetry } from '../../services/workflow-support.js';

export interface WorkflowTelemetryConfig {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

class DiscoveredDesktopTelemetry implements TelemetryPort {
  constructor(private readonly discovery: WindowsDesktopReceiverDiscovery) {}

  async export(batch: TelemetryBatch): Promise<void> {
    const discovered = await this.discovery.discover();
    if (discovered.status !== 'available') return;
    await new CanonicalOtlpJsonExporter({
      endpoint: discovered.connection.endpoint,
      headers: { 'x-repoctopus-session': discovered.connection.sessionToken },
    }).export(batch);
  }
}

export class WorkflowTelemetryProvider extends WorkflowTelemetry {
  private readonly telemetry: TelemetryPort;

  constructor(context: Context, config: WorkflowTelemetryConfig = {}) {
    super(context);
    const environment = config.environment ?? process.env;
    const platform = config.platform ?? process.platform;
    const destinations = [];
    if (remoteTelemetryEnabled(environment)) {
      destinations.push({
        destinationId: 'remote:configured',
        telemetry: telemetryFromEnvironment(environment),
      });
    }
    if (platform === 'win32' && desktopAutostartEnabled(environment)) {
      destinations.push({
        destinationId: 'desktop:local',
        telemetry: new DiscoveredDesktopTelemetry(
          new WindowsDesktopReceiverDiscovery({ environment, platform }),
        ),
      });
    }
    this.telemetry = new IsolatedTelemetryFanout(destinations);
    context.effect(() => () => this.shutdown());
  }

  export(batch: TelemetryBatch): Promise<void> {
    return this.telemetry.export(batch);
  }

  async shutdown(): Promise<void> {
    await this.telemetry.shutdown?.();
  }
}
