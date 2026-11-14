import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import { encodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import { ObservationPipeline } from './observation-pipeline.js';
import type {
  ObservationDestinationMode,
  ObservationDestinationStatus,
  ObservationSignal,
} from './observation-pipeline.js';

const SIGNAL_ROUTES = { trace: 'traces', log: 'logs', metric: 'metrics' } as const;
const REJECTED_RECORDS = {
  trace: 'rejectedSpans',
  log: 'rejectedLogRecords',
  metric: 'rejectedDataPoints',
} as const;

export interface ObservationDestination {
  id: string;
  endpoint?: string;
  signalEndpoints?: Partial<Record<'trace' | 'log' | 'metric', string>>;
  headers?: Readonly<Record<string, string>>;
  signalHeaders?: Partial<Record<'trace' | 'log' | 'metric', Readonly<Record<string, string>>>>;
  timeoutMillis?: number;
  signalTimeouts?: Partial<Record<'trace' | 'log' | 'metric', number>>;
  resourceAttributes?: Readonly<Record<string, string | number | boolean>>;
  select?: (envelope: ObservationEnvelope, signal: ObservationSignal) => boolean;
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
    private readonly config: { workspaceRoot?: string; workspaceOtlpEndpoint?: string } = {},
  ) {
    super(context, 'observationDelivery');
  }

  get workspaceOtlpEndpoint(): string | undefined {
    return this.config.workspaceOtlpEndpoint;
  }

  async append(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    await (await this.store()).append(envelopes);
  }

  async replay(destination: ObservationDestination): Promise<ObservationDeliveryResult> {
    const store = await this.store();
    try {
      return await store.withReplayLock(destination.id, async () => {
        const status = await store.status(destination.id);
        if (status.mode !== 'enabled') {
          return { destinationId: destination.id, delivered: 0, skipped: status.mode };
        }
        const baseEndpoint = destination.endpoint?.trim().replace(/\/$/u, '');
        const targets = (Object.keys(SIGNAL_ROUTES) as ObservationSignal[]).flatMap((signal) => {
          const endpoint =
            destination.signalEndpoints?.[signal]?.trim() ||
            (baseEndpoint && `${baseEndpoint}/v1/${SIGNAL_ROUTES[signal]}`);
          return endpoint ? [{ signal, endpoint }] : [];
        });
        if (!targets.length) throw new Error('No OTLP endpoint');
        await store.setActiveSignals(
          destination.id,
          targets.map(({ signal }) => signal),
        );
        const results = await Promise.all(
          targets.map(async ({ signal, endpoint }) =>
            this.replaySignal(store, destination, signal, endpoint),
          ),
        );
        const warning = results.find((result) => result.warning)?.warning;
        const delivered = Math.max(0, ...results.map((result) => result.delivered));
        if (results.some((result) => result.delivered > 0 || result.warning)) {
          await store.recordAttempt(destination.id, {
            result: warning ? 'failed' : 'succeeded',
            attemptedAt: new Date().toISOString(),
            ...(warning ? { warningCode: warning } : {}),
          });
        }
        return {
          destinationId: destination.id,
          delivered: warning ? 0 : delivered,
          ...(warning ? { warning: `OTLP destination ${warning}` } : {}),
        };
      });
    } catch {
      const warningCode = 'unavailable';
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

  private async replaySignal(
    store: ObservationPipeline,
    destination: ObservationDestination,
    signal: ObservationSignal,
    endpoint: string,
  ): Promise<{ delivered: number; warning?: string }> {
    const pending = await store.pendingSignal(destination.id, signal);
    if (!pending.length) return { delivered: 0 };
    const selected = pending
      .map(({ envelope }) => envelope)
      .filter((envelope) => destination.select?.(envelope, signal) ?? true);
    let warning: string | undefined;
    let rejectedRecords = 0;
    try {
      if (selected.length) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(destination.signalHeaders?.[signal] ?? destination.headers ?? {}),
          },
          body: encodeObservationOtlpJson(selected, signal, {
            ...(destination.resourceAttributes
              ? { resourceAttributes: destination.resourceAttributes }
              : {}),
          }),
          signal: AbortSignal.timeout(
            destination.signalTimeouts?.[signal] ?? destination.timeoutMillis ?? 5_000,
          ),
        });
        if (!response.ok) {
          warning = 'rejected';
        } else {
          const content = await response.text();
          const acknowledgement = content ? JSON.parse(content) : {};
          rejectedRecords = Number(
            acknowledgement?.partialSuccess?.[REJECTED_RECORDS[signal]] ?? 0,
          );
          if (!Number.isSafeInteger(rejectedRecords) || rejectedRecords < 0) {
            throw new Error('Invalid OTLP partial success count');
          }
          if (rejectedRecords > 0) warning = 'partial-rejection';
        }
      }
    } catch {
      rejectedRecords = 0;
      warning = 'confirmation-unknown';
    }
    await store.recordSignalAttempt(
      destination.id,
      signal,
      {
        result: warning ? 'failed' : 'succeeded',
        attemptedAt: new Date().toISOString(),
        ...(warning ? { warningCode: warning } : {}),
      },
      !warning || warning === 'partial-rejection' ? pending.at(-1) : undefined,
      rejectedRecords,
    );
    return {
      delivered: warning ? 0 : selected.length,
      ...(warning ? { warning } : {}),
    };
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
