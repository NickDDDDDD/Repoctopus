import type { Context } from '@deepseek-ai/cordis';

export interface OperationScope {
  readonly signal: AbortSignal;
  markDurableBoundary: () => void;
}

interface ActiveOperation {
  controller: AbortController;
  cancellable: boolean;
  durableBoundary: boolean;
  settled: Promise<void>;
}

export interface DrainResult {
  drained: boolean;
  remaining: number;
}

export class ServiceDrainingError extends Error {
  constructor() {
    super('Service is draining and no longer accepts new operations');
    this.name = 'ServiceDrainingError';
  }
}

export class OperationOwnership {
  private accepting = true;
  private readonly active = new Set<ActiveOperation>();

  async run<T>(
    options: { cancellable: boolean; signal?: AbortSignal | undefined },
    operation: (scope: OperationScope) => Promise<T>,
  ): Promise<T> {
    if (!this.accepting) throw new ServiceDrainingError();
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    let settle!: () => void;
    const active: ActiveOperation = {
      controller,
      cancellable: options.cancellable,
      durableBoundary: false,
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    this.active.add(active);
    try {
      return await operation({
        signal,
        markDurableBoundary() {
          active.durableBoundary = true;
        },
      });
    } finally {
      this.active.delete(active);
      settle();
    }
  }

  async drain(timeoutMs: number): Promise<DrainResult> {
    this.accepting = false;
    for (const operation of this.active) {
      if (operation.cancellable && !operation.durableBoundary) {
        operation.controller.abort(new Error('Service is shutting down'));
      }
    }
    if (this.active.size === 0) return { drained: true, remaining: 0 };

    const settled = Promise.allSettled([...this.active].map((operation) => operation.settled));
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    return { drained: this.active.size === 0, remaining: this.active.size };
  }
}

export function bindOperationOwnership(
  context: Context,
  service: string,
  timeoutMs = 5_000,
): OperationOwnership {
  const ownership = new OperationOwnership();
  const diagnostics = context.get('lifecycleDiagnostics');
  context.effect(
    () => async () => {
      const result = await ownership.drain(timeoutMs);
      if (result.drained) return;
      diagnostics?.record({
        code: 'OPERATION_DRAIN_TIMEOUT',
        service,
        remaining: result.remaining,
        recoverability: 'journal_or_checkpoint',
        timestamp: new Date().toISOString(),
      });
      diagnostics?.event({
        type: 'operation.drain',
        phase: 'draining',
        result: 'timed_out',
        service,
        remaining: result.remaining,
        recoverability: 'journal_or_checkpoint',
      });
      context.logger.warn(
        'operation drain timed out for %s with %d operation(s) remaining',
        service,
        result.remaining,
      );
    },
    `repoctopus.operation-ownership:${service}`,
  );
  return ownership;
}
