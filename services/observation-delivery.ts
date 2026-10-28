import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import { encodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import { ObservationPipeline } from './observation-pipeline.js';

export interface ObservationDestination {
  id: string;
  endpoint: string;
  headers?: Readonly<Record<string, string>>;
}

export interface ObservationDeliveryResult {
  destinationId: string;
  delivered: number;
  warning?: string;
}

/** Shared outbox boundary used by remote OTLP and the optional Desktop destination. */
export class ObservationDelivery extends Service {
  private pipeline: Promise<ObservationPipeline> | null = null;

  constructor(
    context: Context,
    private readonly config: { workspaceRoot?: string } = {},
  ) {
    super(context, 'observationDelivery');
  }

  async append(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    await (await this.store()).append(envelopes);
  }

  async replay(destination: ObservationDestination): Promise<ObservationDeliveryResult> {
    const store = await this.store();
    const pending = await store.pending(destination.id);
    if (pending.length === 0) return { destinationId: destination.id, delivered: 0 };
    try {
      const response = await fetch(`${destination.endpoint.replace(/\/$/u, '')}/v1/logs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(destination.headers ?? {}),
        },
        body: encodeObservationOtlpJson(pending, 'log'),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`OTLP destination returned ${response.status}`);
      await store.acknowledge(destination.id, pending.at(-1)!.envelopeId);
      return { destinationId: destination.id, delivered: pending.length };
    } catch (error) {
      return {
        destinationId: destination.id,
        delivered: 0,
        warning: error instanceof Error ? error.message : 'OTLP destination delivery failed',
      };
    }
  }

  private store(): Promise<ObservationPipeline> {
    this.pipeline ??= ObservationPipeline.open(
      path.join(this.config.workspaceRoot ?? process.cwd(), '.repoctopus', 'telemetry'),
    );
    return this.pipeline;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    observationDelivery: ObservationDelivery;
  }
}
