import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import { encodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import { ObservationPipeline } from './observation-pipeline.js';
import type {
  ObservationDestinationMode,
  ObservationDestinationStatus,
} from './observation-pipeline.js';

export interface ObservationDestination {
  id: string;
  endpoint?: string;
  signalEndpoints?: Partial<Record<'trace' | 'log' | 'metric', string>>;
  headers?: Readonly<Record<string, string>>;
  signalHeaders?: Partial<Record<'trace' | 'log' | 'metric', Readonly<Record<string, string>>>>;
  timeoutMillis?: number;
  signalTimeouts?: Partial<Record<'trace' | 'log' | 'metric', number>>;
  resourceAttributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ObservationDeliveryResult {
  destinationId: string;
  delivered: number;
  warning?: string;
  skipped?: 'paused' | 'removed';
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
    const status = await store.status(destination.id);
    if (status.mode === 'paused' || status.mode === 'removed') {
      return { destinationId: destination.id, delivered: 0, skipped: status.mode };
    }
    await store.configureDestination(destination.id, 'enabled');
    const pending = await store.pending(destination.id);
    if (pending.length === 0) return { destinationId: destination.id, delivered: 0 };
    try {
      const activeSignals = (['trace', 'log', 'metric'] as const).filter(
        (signal) => destination.signalEndpoints?.[signal]?.trim() || destination.endpoint?.trim(),
      );
      if (activeSignals.length === 0) throw new Error('unavailable:missing-endpoint');
      await Promise.all(
        activeSignals.map(async (signal) => {
          const route = signal === 'trace' ? 'traces' : signal === 'log' ? 'logs' : 'metrics';
          const signalEndpoint = destination.signalEndpoints?.[signal]?.trim();
          const baseEndpoint = destination.endpoint?.trim().replace(/\/$/u, '');
          const endpoint = signalEndpoint || (baseEndpoint ? `${baseEndpoint}/v1/${route}` : '');
          if (!endpoint) throw new Error('unavailable:missing-endpoint');
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(destination.signalHeaders?.[signal] ?? destination.headers ?? {}),
            },
            body: encodeObservationOtlpJson(pending, signal, {
              ...(destination.resourceAttributes
                ? { resourceAttributes: destination.resourceAttributes }
                : {}),
            }),
            signal: AbortSignal.timeout(
              destination.signalTimeouts?.[signal] ?? destination.timeoutMillis ?? 5_000,
            ),
          });
          if (!response.ok) throw new Error(`rejected:${response.status}`);
        }),
      );
      await store.acknowledge(destination.id, pending.at(-1)!.envelopeId);
      await store.recordAttempt(destination.id, {
        result: 'succeeded',
        attemptedAt: new Date().toISOString(),
      });
      return { destinationId: destination.id, delivered: pending.length };
    } catch (error) {
      const warningCode =
        error instanceof Error && error.message.startsWith('rejected:')
          ? 'rejected'
          : 'unavailable';
      await store.recordAttempt(destination.id, {
        result: 'failed',
        attemptedAt: new Date().toISOString(),
        warningCode,
      });
      return {
        destinationId: destination.id,
        delivered: 0,
        warning: `OTLP destination ${warningCode}`,
      };
    }
  }

  replayAll(
    destinations: readonly ObservationDestination[],
  ): Promise<readonly ObservationDeliveryResult[]> {
    return Promise.all(destinations.map((destination) => this.replay(destination)));
  }

  async setMode(destinationId: string, mode: ObservationDestinationMode): Promise<void> {
    await (await this.store()).configureDestination(destinationId, mode);
  }

  async health(destinationId: string): Promise<ObservationDestinationStatus> {
    return (await this.store()).status(destinationId);
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
