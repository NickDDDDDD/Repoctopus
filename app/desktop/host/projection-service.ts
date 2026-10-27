import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionDelta,
  type ChangeProjectionObservation,
  type ChangeProjectionSnapshot,
} from '../../../domains/telemetry/change-projection.js';
import {
  ProjectionJournalStore,
  type ProjectionRecoveryDiagnostic,
} from './projection-journal-store.js';

export type DesktopProjectionListener = (
  snapshot: ChangeProjectionSnapshot,
  delta: ChangeProjectionDelta,
) => void;

/** Single Desktop Host owner for the in-memory Change projection. */
export class DesktopProjection extends Service {
  private current = createEmptyChangeProjection();
  private readonly listeners = new Set<DesktopProjectionListener>();
  private store: ProjectionJournalStore | null = null;
  private recovery: readonly ProjectionRecoveryDiagnostic[] = [];
  private transition = Promise.resolve();

  constructor(context: Context) {
    super(context, 'desktopProjection');
  }

  snapshot(): ChangeProjectionSnapshot {
    return structuredClone(this.current);
  }

  async start(): Promise<void> {
    const directory = process.env.REPOCTOPUS_DESKTOP_DATA_DIR?.trim();
    if (!directory || this.store !== null) return;
    const store = await ProjectionJournalStore.open(directory, this.current);
    this.store = store;
    this.current = store.snapshot;
    this.recovery = store.diagnostics;
  }

  recoveryDiagnostics(): readonly ProjectionRecoveryDiagnostic[] {
    return structuredClone(this.recovery);
  }

  accept(observation: ChangeProjectionObservation): Promise<ChangeProjectionDelta | null> {
    return this.acceptMany([observation]).then((deltas) => deltas[0] ?? null);
  }

  acceptMany(
    observations: readonly ChangeProjectionObservation[],
  ): Promise<readonly ChangeProjectionDelta[]> {
    let resolveResult!: (value: readonly ChangeProjectionDelta[]) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<readonly ChangeProjectionDelta[]>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.transition = this.transition.then(async () => {
      try {
        const accepted: ChangeProjectionObservation[] = [];
        const publications: { snapshot: ChangeProjectionSnapshot; delta: ChangeProjectionDelta }[] =
          [];
        let next = this.current;
        for (const observation of observations) {
          const reduced = reduceChangeProjection(next, observation);
          next = reduced.snapshot;
          if (reduced.delta !== null) {
            accepted.push(observation);
            publications.push({ snapshot: structuredClone(next), delta: reduced.delta });
          }
        }
        await this.store?.append(accepted, next);
        this.current = next;
        for (const publication of publications) {
          for (const listener of this.listeners) {
            listener(structuredClone(publication.snapshot), publication.delta);
          }
        }
        resolveResult(publications.map((publication) => publication.delta));
      } catch (error) {
        rejectResult(error);
      }
    });
    return result;
  }

  async close(): Promise<void> {
    await this.transition;
    await this.store?.close(this.current);
    this.store = null;
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
