import { Service, type Context } from '@deepseek-ai/cordis';

import type { ObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import type {
  ObservationDestinationState,
  ObservationDestinationStatus,
} from '../domains/telemetry/destination.js';

/** Durable, destination-neutral ingress for already-mapped observation facts. */
export abstract class ObservationTelemetry extends Service {
  constructor(context: Context) {
    super(context, 'observationTelemetry');
  }

  abstract publish(envelopes: readonly ObservationEnvelope[]): Promise<void>;
  abstract destinationStatus(destinationId: string): Promise<ObservationDestinationStatus>;
  abstract setDestinationState(
    destinationId: string,
    state: ObservationDestinationState,
  ): Promise<ObservationDestinationStatus>;
  abstract shutdown(): Promise<void>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    observationTelemetry: ObservationTelemetry;
  }
}
