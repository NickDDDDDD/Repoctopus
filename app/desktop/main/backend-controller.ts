export type DesktopBackendState =
  | { phase: 'starting' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string; failure: unknown };

export interface DesktopBackendHost {
  start(): Promise<unknown>;
  stop(): Promise<void>;
}

interface Attempt<Host> {
  cancelled: boolean;
  failure?: Error;
  host?: Host;
  cleanup?: Promise<void>;
}

function errorState(failure: unknown): DesktopBackendState {
  return {
    phase: 'error',
    message: failure instanceof Error ? failure.message : 'Desktop Host failed',
    failure,
  };
}

/** Serializes start, retry and stop so a Desktop Host cannot outlive its Shell. */
export class DesktopBackendController<Host extends DesktopBackendHost> {
  private current: DesktopBackendState = { phase: 'starting' };
  private attempt: Attempt<Host> | undefined;
  private pending: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly createHost: (onFailure: (error: Error) => void) => Host,
    private readonly publish: (state: DesktopBackendState) => void,
  ) {}

  get state(): DesktopBackendState {
    return this.current;
  }

  get host(): Host | undefined {
    return !this.closed && !this.attempt?.cancelled && this.current.phase === 'ready'
      ? this.attempt?.host
      : undefined;
  }

  start(prepare: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(new Error('desktop backend is closed'));
    if (this.stopping !== undefined) {
      return Promise.reject(new Error('desktop backend is stopping'));
    }
    if (this.pending !== undefined) return this.pending;
    if (this.current.phase === 'ready') return Promise.resolve();

    const previous = this.attempt;
    const attempt: Attempt<Host> = {
      cancelled: false,
      ...(previous?.cleanup === undefined ? {} : { cleanup: previous.cleanup }),
    };
    this.attempt = attempt;
    this.update({ phase: 'starting' });
    const pending = Promise.resolve()
      .then(async () => {
        try {
          await previous?.cleanup;
          delete attempt.cleanup;
          if (attempt.cancelled) return;
          await prepare();
          if (attempt.cancelled) return;
          const host = this.createHost((error) => {
            this.failed(attempt, error);
          });
          attempt.host = host;
          await host.start();
          if (attempt.failure !== undefined) throw attempt.failure;
          if (!attempt.cancelled) this.update({ phase: 'ready' });
        } catch (error) {
          const cancelled = attempt.cancelled;
          attempt.cancelled = true;
          let failure = error;
          try {
            await this.cleanup(attempt);
          } catch (cleanupError) {
            if (cleanupError !== error) {
              failure = new AggregateError(
                [error, cleanupError],
                'desktop backend startup and cleanup failed',
              );
            }
          }
          if (!cancelled) this.update(errorState(failure));
          throw failure;
        }
      })
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }

  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    const attempt = this.attempt;
    if (attempt !== undefined) attempt.cancelled = true;
    if (!this.closed) this.update({ phase: 'starting' });
    const pending = this.pending;
    const stopping = Promise.allSettled([
      attempt === undefined ? Promise.resolve() : this.cleanup(attempt),
      pending,
    ])
      .then((results) => {
        const cleanup = results[0];
        if (cleanup.status === 'rejected') throw cleanup.reason;
        if (this.attempt === attempt) this.attempt = undefined;
      })
      .finally(() => {
        if (this.stopping === stopping) this.stopping = undefined;
      });
    this.stopping = stopping;
    return stopping;
  }

  close(): Promise<void> {
    this.closed = true;
    return this.stop();
  }

  private cleanup(attempt: Attempt<Host>): Promise<void> {
    if (attempt.cleanup === undefined) {
      attempt.cleanup = Promise.resolve().then(async () => {
        await attempt.host?.stop();
      });
    }
    return attempt.cleanup;
  }

  private failed(attempt: Attempt<Host>, error: Error): void {
    if (this.attempt !== attempt || attempt.cancelled) return;
    attempt.failure = error;
    if (this.current.phase !== 'ready') return;
    attempt.cancelled = true;
    const cleanup = this.cleanup(attempt);
    this.update(errorState(error));
    void cleanup.catch((cleanupError: unknown) => {
      if (this.attempt === attempt) {
        this.update(
          errorState(
            new AggregateError([error, cleanupError], 'Desktop backend failed and could not stop'),
          ),
        );
      }
    });
  }

  private update(state: DesktopBackendState): void {
    if (this.closed) return;
    this.current = state;
    try {
      this.publish(state);
    } catch (error) {
      console.error('desktop backend state listener failed', error);
    }
  }
}
