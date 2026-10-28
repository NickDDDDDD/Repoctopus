import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionDelta,
  type ChangeProjectionSnapshot,
} from '../domains/trajectory/projection.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';

export type DesktopProjectionListener = (
  snapshot: ChangeProjectionSnapshot,
  delta: ChangeProjectionDelta,
) => void;

/** Host-owned projection transaction boundary; callers never operate the reducer directly. */
export class DesktopProjection extends Service {
  private current = createEmptyChangeProjection();
  private readonly listeners = new Set<DesktopProjectionListener>();
  private transition = Promise.resolve();

  constructor(context: Context) {
    super(context, 'desktopProjection');
  }

  snapshot(): ChangeProjectionSnapshot {
    return structuredClone(this.current);
  }

  ingest(envelopes: readonly ObservationEnvelope[]): Promise<readonly ChangeProjectionDelta[]> {
    let resolveResult!: (deltas: readonly ChangeProjectionDelta[]) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<readonly ChangeProjectionDelta[]>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.transition = this.transition.then(() => {
      try {
        const publications: Array<{
          snapshot: ChangeProjectionSnapshot;
          delta: ChangeProjectionDelta;
        }> = [];
        for (const envelope of envelopes) {
          const reduction = reduceChangeProjection(this.current, envelope);
          this.current = reduction.snapshot;
          if (reduction.delta !== null) {
            publications.push({ snapshot: this.snapshot(), delta: reduction.delta });
          }
        }
        for (const publication of publications) {
          for (const listener of this.listeners) {
            listener(structuredClone(publication.snapshot), structuredClone(publication.delta));
          }
        }
        resolveResult(publications.map((publication) => publication.delta));
      } catch (error) {
        rejectResult(error);
      }
    });
    return result;
  }

  subscribe(listener: DesktopProjectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopProjection: DesktopProjection;
  }
}
