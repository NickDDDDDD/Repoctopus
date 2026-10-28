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

export interface DesktopProjectionJournal {
  readonly snapshot: ChangeProjectionSnapshot;
  append(
    observations: readonly ObservationEnvelope[],
    next: ChangeProjectionSnapshot,
  ): Promise<void>;
  close(next: ChangeProjectionSnapshot): Promise<void>;
}

/** Host-owned projection transaction boundary; callers never operate the reducer directly. */
export class DesktopProjection extends Service {
  private current = createEmptyChangeProjection();
  private readonly listeners = new Set<DesktopProjectionListener>();
  private transition = Promise.resolve();
  private journal: DesktopProjectionJournal | undefined;

  constructor(context: Context) {
    super(context, 'desktopProjection');
  }

  snapshot(): ChangeProjectionSnapshot {
    return structuredClone(this.current);
  }

  async attachJournal(journal: DesktopProjectionJournal): Promise<void> {
    await this.transition;
    if (this.journal !== undefined)
      throw new Error('Desktop projection journal is already attached');
    this.journal = journal;
    this.current = structuredClone(journal.snapshot);
  }

  async closeJournal(): Promise<void> {
    await this.transition;
    const journal = this.journal;
    this.journal = undefined;
    await journal?.close(this.current);
  }

  ingest(envelopes: readonly ObservationEnvelope[]): Promise<readonly ChangeProjectionDelta[]> {
    let resolveResult!: (deltas: readonly ChangeProjectionDelta[]) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<readonly ChangeProjectionDelta[]>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const execution = this.transition
      .catch(() => undefined)
      .then(async () => {
        const publications: Array<{
          snapshot: ChangeProjectionSnapshot;
          delta: ChangeProjectionDelta;
        }> = [];
        let next = this.current;
        for (const envelope of envelopes) {
          const reduction = reduceChangeProjection(next, envelope);
          next = reduction.snapshot;
          if (reduction.delta !== null) {
            publications.push({ snapshot: structuredClone(next), delta: reduction.delta });
          }
        }
        await this.journal?.append(envelopes, next);
        this.current = next;
        for (const publication of publications) {
          for (const listener of this.listeners) {
            listener(structuredClone(publication.snapshot), structuredClone(publication.delta));
          }
        }
        return publications.map((publication) => publication.delta);
      });
    this.transition = execution.then(
      () => undefined,
      () => undefined,
    );
    void execution.then(resolveResult, rejectResult);
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
