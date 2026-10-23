import type { Context } from '@deepseek-ai/cordis';

import type { TelemetryBatch, TelemetryPort } from '../../domains/runtime/types.js';
import { telemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/exporter.js';
import { WorkflowTelemetry } from '../../services/workflow-support.js';
import { FileObservationEnvelopeStore } from '../../platform/telemetry/observation-envelope-store.js';
import { mapWorkflowObservationEnvelope } from '../../platform/telemetry/observation-workflow-mapping.js';

export interface WorkflowTelemetryConfig {
  environment?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
}

export class WorkflowTelemetryProvider extends WorkflowTelemetry {
  private readonly telemetry: TelemetryPort;
  private readonly store: FileObservationEnvelopeStore;

  constructor(context: Context, config: WorkflowTelemetryConfig = {}) {
    super(context);
    this.telemetry = telemetryFromEnvironment(config.environment ?? process.env);
    this.store = new FileObservationEnvelopeStore(config.workspaceRoot ?? process.cwd());
    context.effect(() => () => this.shutdown());
  }

  async export(batch: TelemetryBatch): Promise<void> {
    const envelopes = batch.events
      .map((event) => mapWorkflowObservationEnvelope(batch, event))
      .filter((envelope) => envelope !== null);
    await Promise.all(envelopes.map((envelope) => this.store.save(envelope)));
    await this.telemetry.export(batch);
  }

  async shutdown(): Promise<void> {
    await this.telemetry.shutdown?.();
  }
}
