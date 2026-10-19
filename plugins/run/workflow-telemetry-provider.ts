import type { Context } from '@deepseek-ai/cordis';

import type { TelemetryBatch, TelemetryPort } from '../../domains/runtime/types.js';
import { telemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/exporter.js';
import { WorkflowTelemetry } from '../../services/workflow-support.js';

export interface WorkflowTelemetryConfig {
  environment?: NodeJS.ProcessEnv;
}

export class WorkflowTelemetryProvider extends WorkflowTelemetry {
  private readonly telemetry: TelemetryPort;

  constructor(context: Context, config: WorkflowTelemetryConfig = {}) {
    super(context);
    this.telemetry = telemetryFromEnvironment(config.environment ?? process.env);
    context.effect(() => () => this.shutdown());
  }

  export(batch: TelemetryBatch): Promise<void> {
    return this.telemetry.export(batch);
  }

  async shutdown(): Promise<void> {
    await this.telemetry.shutdown?.();
  }
}
