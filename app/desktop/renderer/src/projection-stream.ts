import type { DesktopProjectionDelta } from '../../../../services/desktop-application.js';
import type { DesktopShellState } from '../../shared/renderer-contract.js';

const MAX_BUFFERED_DELTAS = 64;

export interface DesktopProjectionStreamOptions {
  currentState(): Promise<DesktopShellState>;
  publish(state: DesktopShellState): void;
}

/**
 * Converges push-driven Shell snapshots and projection deltas without polling.
 * A forward gap triggers one bounded snapshot read; stale or duplicate deltas
 * are discarded and can never rewind a newer snapshot.
 */
export class DesktopProjectionStream {
  private state: DesktopShellState = { phase: 'starting' };
  private version = -1;
  private readonly pending = new Map<number, DesktopProjectionDelta>();
  private resync: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly options: DesktopProjectionStreamOptions) {}

  start(): void {
    this.requestSnapshot();
  }

  acceptState(next: DesktopShellState): void {
    if (this.closed) return;
    if (next.phase !== 'ready') {
      this.state = next;
      this.version = -1;
      this.pending.clear();
      this.options.publish(next);
      return;
    }
    const nextVersion = next.snapshot.projection.version;
    if (this.state.phase === 'ready' && nextVersion < this.version) return;
    this.state = next;
    this.version = nextVersion;
    this.options.publish(next);
    this.discardObsolete();
    this.applyContiguousDeltas();
  }

  acceptDelta(delta: DesktopProjectionDelta): void {
    if (this.closed || delta.version <= this.version) return;
    this.pending.set(delta.version, delta);
    this.trimPending();
    this.applyContiguousDeltas();
    if (this.pending.size > 0) this.requestSnapshot();
  }

  close(): void {
    this.closed = true;
    this.pending.clear();
  }

  private applyContiguousDeltas(): void {
    if (this.state.phase !== 'ready') return;
    while (true) {
      const next = [...this.pending.values()]
        .filter((delta) => delta.baseVersion === this.version)
        .sort((left, right) => left.version - right.version)[0];
      if (next === undefined) return;
      this.pending.delete(next.version);
      this.version = next.version;
      this.state = {
        phase: 'ready',
        snapshot: {
          ...this.state.snapshot,
          projection: next.projection,
          ingress: next.ingress,
        },
      };
      this.options.publish(this.state);
      this.discardObsolete();
    }
  }

  private requestSnapshot(): void {
    if (this.closed || this.resync !== null) return;
    const resync = this.options
      .currentState()
      .then((state) => {
        this.acceptState(state);
      })
      .catch(() => {
        // Backend lifecycle events own user-visible failures. A later pushed
        // delta may request one more snapshot; this path never starts polling.
      })
      .finally(() => {
        if (this.resync === resync) this.resync = null;
      });
    this.resync = resync;
  }

  private discardObsolete(): void {
    for (const [version, delta] of this.pending) {
      if (version <= this.version || delta.baseVersion < this.version) {
        this.pending.delete(version);
      }
    }
  }

  private trimPending(): void {
    const versions = [...this.pending.keys()].sort((left, right) => left - right);
    for (const version of versions.slice(0, -MAX_BUFFERED_DELTAS)) {
      this.pending.delete(version);
    }
  }
}
