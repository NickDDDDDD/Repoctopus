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
const RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);

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
  private deferredRemote: ObservationDestination | undefined;
  private deferRemote = false;

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
    if (envelopes.length === 0) return;
    await (await this.store()).append(envelopes);
  }

  deferRemoteUntilClose(): void {
    this.deferRemote = true;
  }

  async deliver(destinations: readonly ObservationDestination[]): Promise<void> {
    if (!this.deferRemote) {
      await this.replayAll(destinations);
      return;
    }
    this.deferredRemote = destinations.find(({ id }) => id === 'remote');
    await this.replayAll(destinations.filter(({ id }) => id !== 'remote'));
  }

  async flushRemote(): Promise<void> {
    const destination = this.deferredRemote;
    if (!destination) return;
    this.deferredRemote = undefined;
    const stopAt = Date.now() + 2_000;
    for (let batch = 0; batch < 4 && Date.now() < stopAt; batch += 1) {
      const result = await this.replay(destination, stopAt);
      if (result.warning || result.skipped || (await this.health(destination.id)).backlog === 0)
        break;
    }
  }

  async replay(
    destination: ObservationDestination,
    deadline?: number,
  ): Promise<ObservationDeliveryResult> {
    const store = await this.store();
    try {
      return await store.withReplayLock(
        destination.id,
        async () => {
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
            deadline,
          );
          const outcomes = await Promise.allSettled(
            targets.map(async ({ signal, endpoint }) =>
              this.replaySignal(store, destination, signal, endpoint, deadline),
            ),
          );
          const results = outcomes.map((outcome) =>
            outcome.status === 'fulfilled'
              ? outcome.value
              : { delivered: 0, warning: 'unavailable' },
          );
          const warning = results.find((result) => result.warning)?.warning;
          const delivered = Math.max(0, ...results.map((result) => result.delivered));
          if (results.some((result) => result.delivered > 0 || result.warning)) {
            await store.recordAttempt(
              destination.id,
              {
                result: warning ? 'failed' : 'succeeded',
                attemptedAt: new Date().toISOString(),
                ...(warning ? { warningCode: warning } : {}),
              },
              deadline,
            );
          }
          return {
            destinationId: destination.id,
            delivered: warning ? 0 : delivered,
            ...(warning ? { warning: `OTLP destination ${warning}` } : {}),
          };
        },
        deadline === undefined ? undefined : Math.max(1, deadline - Date.now()),
      );
    } catch {
      const warningCode = 'unavailable';
      await store.recordAttempt(
        destination.id,
        {
          result: 'failed',
          attemptedAt: new Date().toISOString(),
          warningCode,
        },
        deadline,
      );
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
    deadline?: number,
  ): Promise<{ delivered: number; warning?: string }> {
    let pending = await store.pendingSignal(destination.id, signal);
    if (!pending.length) return { delivered: 0 };
    const select = () =>
      pending
        .map(({ envelope }) => envelope)
        .filter((envelope) => destination.select?.(envelope, signal) ?? true);
    let selected = select();
    const encode = () =>
      encodeObservationOtlpJson(selected, signal, {
        ...(destination.resourceAttributes
          ? { resourceAttributes: destination.resourceAttributes }
          : {}),
      });
    let body = selected.length ? encode() : '';
    const wireLimit = destination.id === 'desktop' ? 1024 * 1024 : 2 * 1024 * 1024;
    const split = () => {
      pending = pending.slice(0, Math.ceil(pending.length / 2));
      selected = select();
      body = selected.length ? encode() : '';
    };
    if (destination.id === 'desktop' || deadline !== undefined) {
      while (pending.length > 1 && Buffer.byteLength(body) > wireLimit) split();
    }
    let warning: string | undefined;
    let rejectedRecords = 0;
    try {
      if (body && deadline !== undefined && Date.now() >= deadline) {
        return { delivered: 0, warning: 'budget-exhausted' };
      }
      if (
        body &&
        (destination.id === 'desktop' || deadline !== undefined) &&
        Buffer.byteLength(body) > wireLimit
      ) {
        warning = 'record-too-large';
        rejectedRecords = 1;
      } else if (body) {
        const send = () =>
          fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(destination.signalHeaders?.[signal] ?? destination.headers ?? {}),
            },
            body,
            signal: AbortSignal.timeout(
              Math.min(
                destination.signalTimeouts?.[signal] ?? destination.timeoutMillis ?? 5_000,
                deadline === undefined ? Infinity : Math.max(1, deadline - Date.now()),
              ),
            ),
          });
        let response: Response | undefined = await send();
        while (response.status === 413 && pending.length > 1) {
          await response.body?.cancel();
          split();
          if (deadline !== undefined && Date.now() >= deadline) {
            return { delivered: 0, warning: 'budget-exhausted' };
          }
          response = body ? await send() : undefined;
          if (!response) break;
        }
        if (response?.status === 413) {
          warning = 'record-too-large';
          rejectedRecords = 1;
        } else if (response && !response.ok) {
          if (destination.id === 'desktop' || RETRYABLE_HTTP_STATUS.has(response.status)) {
            warning = 'rejected';
          } else {
            warning = 'permanent-rejection';
            rejectedRecords = selected.length;
          }
        } else if (response) {
          const content = await response.text();
          const acknowledgement: unknown = content ? JSON.parse(content) : {};
          if (
            typeof acknowledgement !== 'object' ||
            !acknowledgement ||
            Array.isArray(acknowledgement)
          ) {
            throw new Error('Invalid OTLP acknowledgement');
          }
          const partial = (acknowledgement as Record<string, unknown>).partialSuccess;
          if (partial !== undefined) {
            if (typeof partial !== 'object' || !partial || Array.isArray(partial)) {
              throw new Error('Invalid OTLP partial success');
            }
            const count = (partial as Record<string, unknown>)[REJECTED_RECORDS[signal]];
            if (count !== undefined && typeof count !== 'string' && typeof count !== 'number') {
              throw new Error('Invalid OTLP partial success count');
            }
            rejectedRecords = Number(count ?? 0);
          }
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
      !warning || rejectedRecords > 0 ? pending.at(-1) : undefined,
      rejectedRecords,
      deadline,
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
