import { Service, type Context } from '@deepseek-ai/cordis';

import type { EventInboxEntry } from '../domains/platform-events/types.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';

export interface PlatformEventRunnerConfig {
  owner: string;
  leaseMs?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
  shutdownTimeoutMs?: number;
}

export interface PlatformEventRunResult {
  processed: number;
}

export type PlatformEventClock = () => Date;

export class PlatformEventRunner extends Service {
  static inject = ['platformEvents'];

  private readonly operations: OperationOwnership;
  private readonly owner: string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private running: Promise<PlatformEventRunResult> | null = null;
  private stopped = false;

  constructor(context: Context, config: PlatformEventRunnerConfig) {
    super(context, 'platformEventRunner');
    if (!config.owner?.trim()) throw new Error('Platform Event Runner owner is required');
    this.owner = config.owner;
    this.leaseMs = this.positive(config.leaseMs ?? 30_000, 'leaseMs');
    this.retryDelayMs = this.positive(config.retryDelayMs ?? 1_000, 'retryDelayMs');
    this.maxAttempts = this.positive(config.maxAttempts ?? 5, 'maxAttempts');
    const pollIntervalMs = this.positive(config.pollIntervalMs ?? 1_000, 'pollIntervalMs');
    this.operations = bindOperationOwnership(
      context,
      'platformEventRunner',
      this.positive(config.shutdownTimeoutMs ?? 5_000, 'shutdownTimeoutMs'),
    );
    context.effect(() => {
      const timer = setInterval(() => {
        void this.runOnce().catch(() => {
          context.logger.warn('Platform Event Runner cycle failed');
        });
      }, pollIntervalMs);
      timer.unref?.();
      return () => {
        this.stopped = true;
        clearInterval(timer);
      };
    }, 'repoctopus.platform-event-runner.timer');
  }

  runOnce(now: PlatformEventClock = () => new Date()): Promise<PlatformEventRunResult> {
    if (this.stopped) return Promise.resolve({ processed: 0 });
    if (this.running) return this.running;
    const cycle = this.runCycle(now).finally(() => {
      if (this.running === cycle) this.running = null;
    });
    this.running = cycle;
    return cycle;
  }

  private async runCycle(now: PlatformEventClock): Promise<PlatformEventRunResult> {
    let processed = 0;
    while (!this.stopped) {
      const handled = await this.operations.run(
        { cancellable: true },
        async ({ signal, markDurableBoundary }) => {
          const entry = await this.ctx.platformEvents.claimDue({
            owner: this.owner,
            timestamp: this.timestamp(now),
            leaseMs: this.leaseMs,
          });
          if (!entry) return false;
          markDurableBoundary();
          if (signal.aborted || this.stopped) return false;
          const renewal = this.startLeaseRenewal(entry, signal, now);
          let outcome;
          try {
            outcome = await this.ctx.platformEvents.process(entry, renewal.signal);
          } catch {
            outcome = { result: 'retry' as const, diagnostic: 'platform-event-processing-failed' };
          } finally {
            await renewal.stop();
          }
          if (signal.aborted) return false;
          const reachedLimit = outcome.result === 'retry' && entry.attempts >= this.maxAttempts;
          const result = reachedLimit ? 'dead_letter' : outcome.result;
          const diagnostic = reachedLimit
            ? 'platform-event-attempt-limit-exceeded'
            : outcome.diagnostic;
          const settledAt = new Date(this.timestamp(now));
          const delay = this.retryDelayMs * 2 ** Math.max(0, entry.attempts - 1);
          await this.ctx.platformEvents.settle({
            envelopeId: entry.envelope.envelopeId,
            leaseToken: entry.lease!.token,
            timestamp: settledAt.toISOString(),
            result,
            ...(result === 'retry'
              ? { retryAt: new Date(settledAt.getTime() + delay).toISOString() }
              : {}),
            ...(diagnostic === undefined ? {} : { diagnostic }),
          });
          return true;
        },
      );
      if (!handled) break;
      processed += 1;
    }
    return { processed };
  }

  private positive(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Platform Event Runner ${name} must be a positive safe integer`);
    }
    return value;
  }

  private timestamp(now: PlatformEventClock): string {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error('Platform Event Runner clock must return a valid Date');
    }
    return value.toISOString();
  }

  private startLeaseRenewal(
    entry: EventInboxEntry,
    operationSignal: AbortSignal,
    now: PlatformEventClock,
  ): { signal: AbortSignal; stop: () => Promise<void> } {
    const controller = new AbortController();
    const signal = AbortSignal.any([operationSignal, controller.signal]);
    const intervalMs = Math.max(1, Math.floor(this.leaseMs / 3));
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    let failure: Error | undefined;
    let inFlight = Promise.resolve();
    const stopScheduling = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    operationSignal.addEventListener('abort', stopScheduling, { once: true });
    const schedule = () => {
      timer = setTimeout(() => {
        inFlight = this.ctx.platformEvents
          .renewLease({
            envelopeId: entry.envelope.envelopeId,
            leaseToken: entry.lease!.token,
            timestamp: this.timestamp(now),
            leaseMs: this.leaseMs,
          })
          .then(() => undefined)
          .catch((error: unknown) => {
            failure = new Error('Platform Event Runner could not renew its processing lease', {
              cause: error,
            });
            controller.abort(failure);
          })
          .finally(() => {
            if (!stopped && !failure) schedule();
          });
      }, intervalMs);
      timer.unref?.();
    };
    schedule();
    return {
      signal,
      async stop() {
        stopScheduling();
        operationSignal.removeEventListener('abort', stopScheduling);
        await inFlight;
        if (failure) throw failure;
      },
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformEventRunner: PlatformEventRunner;
  }
}
