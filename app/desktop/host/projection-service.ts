import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionDelta,
  type ChangeProjectionObservation,
  type ChangeProjectionSnapshot,
} from '../../../domains/telemetry/change-projection.js';

export type DesktopProjectionListener = (
  snapshot: ChangeProjectionSnapshot,
  delta: ChangeProjectionDelta,
) => void;

/** Single Desktop Host owner for the in-memory Change projection. */
export class DesktopProjection extends Service {
  private current = createEmptyChangeProjection();
  private readonly listeners = new Set<DesktopProjectionListener>();

  constructor(context: Context) {
    super(context, 'desktopProjection');
  }

  snapshot(): ChangeProjectionSnapshot {
    return structuredClone(this.current);
  }

  accept(observation: ChangeProjectionObservation): ChangeProjectionDelta | null {
    const reduced = reduceChangeProjection(this.current, observation);
    this.current = reduced.snapshot;
    if (reduced.delta) {
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot, reduced.delta);
    }
    return reduced.delta;
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
