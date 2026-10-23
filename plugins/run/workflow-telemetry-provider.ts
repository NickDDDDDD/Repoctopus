import type { Context } from '@deepseek-ai/cordis';

import type { TelemetryBatch } from '../../domains/runtime/types.js';
import { WorkflowTelemetry } from '../../services/workflow-support.js';
import { FileObservationEnvelopeStore } from '../../platform/telemetry/observation-envelope-store.js';
import { mapWorkflowObservationEnvelope } from '../../platform/telemetry/observation-workflow-mapping.js';
import {
  ObservationOtlpJsonDestination,
  observationOtlpJsonConfigFromEnvironment,
} from '../../platform/telemetry/observation-otlp-json.js';

export const REMOTE_OTLP_DESTINATION_ID = 'remote-otlp';

export interface WorkflowTelemetryConfig {
  environment?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
}

export class WorkflowTelemetryProvider extends WorkflowTelemetry {
  private readonly store: FileObservationEnvelopeStore;
  private readonly remote: ObservationOtlpJsonDestination | null;
  private remoteDelivery: Promise<void> = Promise.resolve();

  constructor(context: Context, config: WorkflowTelemetryConfig = {}) {
    super(context);
    const remoteConfig = observationOtlpJsonConfigFromEnvironment(
      config.environment ?? process.env,
    );
    this.remote = remoteConfig ? new ObservationOtlpJsonDestination(remoteConfig) : null;
    this.store = new FileObservationEnvelopeStore(config.workspaceRoot ?? process.cwd());
    context.effect(() => () => this.shutdown());
  }

  async export(batch: TelemetryBatch): Promise<void> {
    const envelopes = batch.events.map((event) => mapWorkflowObservationEnvelope(batch, event));
    await Promise.all(envelopes.map((envelope) => this.store.save(envelope)));
    if (this.remote === null) return;
    const delivery = this.remoteDelivery.catch(() => undefined).then(() => this.replayRemote());
    this.remoteDelivery = delivery;
    await delivery;
  }

  async shutdown(): Promise<void> {
    await this.remoteDelivery.catch(() => undefined);
  }

  private async replayRemote(): Promise<void> {
    const pending = await this.store.pending(REMOTE_OTLP_DESTINATION_ID);
    if (pending.length === 0 || this.remote === null) return;
    try {
      await this.remote.deliver(pending);
      for (const envelope of pending) {
        await this.store.acknowledge(REMOTE_OTLP_DESTINATION_ID, envelope);
      }
    } catch (error) {
      await this.store.recordFailure(REMOTE_OTLP_DESTINATION_ID, 'remote-delivery-failed');
      throw new Error('Remote OTLP telemetry replay failed', { cause: error });
    }
  }
}
