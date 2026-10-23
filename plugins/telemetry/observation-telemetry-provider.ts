import type { Context } from '@deepseek-ai/cordis';

import type { ObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';
import type {
  ObservationDestinationState,
  ObservationDestinationStatus,
  ObservationRetentionPolicy,
} from '../../domains/telemetry/destination.js';
import { FileObservationEnvelopeStore } from '../../platform/telemetry/observation-envelope-store.js';
import {
  ObservationOtlpJsonDestination,
  observationOtlpJsonConfigFromEnvironment,
} from '../../platform/telemetry/observation-otlp-json.js';
import { ObservationTelemetry } from '../../services/observation-telemetry.js';

export const REMOTE_OTLP_DESTINATION_ID = 'remote-otlp';

export interface ObservationTelemetryConfig {
  environment?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
  retention?: Partial<ObservationRetentionPolicy>;
}

export class ObservationTelemetryProvider extends ObservationTelemetry {
  private readonly store: FileObservationEnvelopeStore;
  private readonly remote: ObservationOtlpJsonDestination | null;
  private remoteDelivery: Promise<void> = Promise.resolve();

  constructor(context: Context, config: ObservationTelemetryConfig = {}) {
    super(context);
    const remoteConfig = observationOtlpJsonConfigFromEnvironment(
      config.environment ?? process.env,
    );
    this.remote = remoteConfig ? new ObservationOtlpJsonDestination(remoteConfig) : null;
    this.store = new FileObservationEnvelopeStore(
      config.workspaceRoot ?? process.cwd(),
      {},
      config.retention,
    );
    context.effect(() => () => this.shutdown());
  }

  async publish(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    if (this.remote !== null) await this.store.ensureDestination(REMOTE_OTLP_DESTINATION_ID);
    await Promise.all(envelopes.map((envelope) => this.store.save(envelope)));
    if (this.remote === null) return;
    const delivery = this.remoteDelivery.catch(() => undefined).then(() => this.replayRemote());
    this.remoteDelivery = delivery;
    await delivery;
  }

  async shutdown(): Promise<void> {
    await this.remoteDelivery.catch(() => undefined);
  }

  destinationStatus(destinationId: string): Promise<ObservationDestinationStatus> {
    return this.store.inspectDestination(destinationId);
  }

  async setDestinationState(
    destinationId: string,
    state: ObservationDestinationState,
  ): Promise<ObservationDestinationStatus> {
    await this.store.setDestinationState(destinationId, state);
    return this.store.inspectDestination(destinationId);
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
