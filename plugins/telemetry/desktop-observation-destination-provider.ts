import type { Context } from '@deepseek-ai/cordis';

import { FileObservationEnvelopeStore } from '../../platform/telemetry/observation-envelope-store.js';
import { ObservationOtlpJsonDestination } from '../../platform/telemetry/observation-otlp-json.js';
import type { DesktopTelemetryEndpoint } from '../../services/desktop-telemetry-receiver.js';
import {
  DesktopTelemetryDestination,
  type DesktopReplayResult,
} from '../../services/desktop-runtime.js';

const DESTINATION_ID = 'desktop-local';

export interface DesktopObservationDestinationConfig {
  workspaceRoot: string;
}

export class DesktopObservationDestinationProvider extends DesktopTelemetryDestination {
  private readonly store: FileObservationEnvelopeStore;

  constructor(context: Context, config: DesktopObservationDestinationConfig) {
    super(context);
    this.store = new FileObservationEnvelopeStore(config.workspaceRoot);
  }

  async replay(endpoint: DesktopTelemetryEndpoint): Promise<DesktopReplayResult> {
    await this.store.ensureDestination(DESTINATION_ID);
    const before = await this.store.inspectDestination(DESTINATION_ID);
    if (before.state !== 'enabled') {
      return { delivered: 0, pending: before.backlog.envelopeCount };
    }
    const pending = await this.store.pending(DESTINATION_ID);
    if (pending.length === 0) return { delivered: 0, pending: 0 };
    try {
      await new ObservationOtlpJsonDestination(endpoint).deliver(pending);
      for (const envelope of pending) await this.store.acknowledge(DESTINATION_ID, envelope);
      return { delivered: pending.length, pending: 0 };
    } catch (error) {
      await this.store.recordFailure(DESTINATION_ID, 'desktop-delivery-failed');
      throw new Error('Desktop telemetry replay failed', { cause: error });
    }
  }
}
