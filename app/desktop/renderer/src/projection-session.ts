import type { DesktopShellState, RepoctopusDesktopBridge } from '../../shared/renderer-contract.js';

/**
 * Owns the Renderer-side snapshot/delta cursor.
 *
 * The Host remains authoritative. The Renderer only accepts the next contiguous
 * projection version; a gap causes one event-driven snapshot refresh and never
 * starts a polling loop.
 */
export class DesktopProjectionSession {
  private current: DesktopShellState = { phase: 'starting' };
  private unsubscribe: (() => void) | undefined;
  private refresh: Promise<void> | undefined;
  private active = false;

  constructor(
    private readonly bridge: RepoctopusDesktopBridge,
    private readonly publish: (state: DesktopShellState) => void,
  ) {}

  async start(): Promise<void> {
    if (this.active) return this.settled();
    this.active = true;
    this.unsubscribe = this.bridge.onState((state) => {
      this.accept(state);
    });
    await this.resynchronize();
  }

  stop(): void {
    this.active = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  settled(): Promise<void> {
    return this.refresh ?? Promise.resolve();
  }

  private accept(state: DesktopShellState): void {
    if (!this.active) return;
    if (state.phase !== 'ready') {
      this.commit(state);
      return;
    }

    const currentVersion = this.current.phase === 'ready' ? this.current.projection.version : null;
    if (state.delta === null) {
      if (currentVersion !== null && state.projection.version < currentVersion) return;
      this.commit(state);
      return;
    }

    if (state.projection.version !== state.delta.version) {
      void this.resynchronize();
      return;
    }
    if (currentVersion === null) {
      void this.resynchronize();
      return;
    }
    if (state.delta.version <= currentVersion) return;
    if (state.delta.version !== currentVersion + 1) {
      void this.resynchronize();
      return;
    }
    this.commit(state);
  }

  private commit(state: DesktopShellState): void {
    this.current = state;
    this.publish(state);
  }

  private resynchronize(): Promise<void> {
    if (this.refresh !== undefined) return this.refresh;
    const refresh = this.bridge
      .currentState()
      .then((state) => {
        this.accept(state);
      })
      .catch((error: unknown) => {
        if (!this.active) return;
        this.commit({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Projection snapshot failed',
        });
      })
      .finally(() => {
        if (this.refresh === refresh) this.refresh = undefined;
      });
    this.refresh = refresh;
    return refresh;
  }
}
