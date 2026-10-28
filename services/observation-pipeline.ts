import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isObservationEnvelope,
  type ObservationEnvelope,
} from '../domains/trajectory/observation.js';

interface ObservationStoreState {
  schemaVersion: 1;
  envelopes: ObservationEnvelope[];
  cursors: Record<string, string | null>;
}

const STORE_FILE = 'observation-envelopes.json';

function emptyState(): ObservationStoreState {
  return { schemaVersion: 1, envelopes: [], cursors: {} };
}

function parseState(value: unknown): ObservationStoreState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Observation Store state is not an object');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.envelopes)) {
    throw new Error('Observation Store schema is unsupported');
  }
  if (!candidate.envelopes.every(isObservationEnvelope)) {
    throw new Error('Observation Store contains an invalid envelope');
  }
  if (
    typeof candidate.cursors !== 'object' ||
    candidate.cursors === null ||
    Array.isArray(candidate.cursors)
  ) {
    throw new Error('Observation Store contains invalid cursors');
  }
  const cursors: Record<string, string | null> = {};
  for (const [destination, cursor] of Object.entries(
    candidate.cursors as Record<string, unknown>,
  )) {
    if (!destination.trim() || (cursor !== null && typeof cursor !== 'string')) {
      throw new Error('Observation Store contains an invalid destination cursor');
    }
    cursors[destination] = cursor;
  }
  return {
    schemaVersion: 1,
    envelopes: candidate.envelopes,
    cursors,
  };
}

/** Durable immutable-envelope store with one acknowledgement cursor per destination. */
export class ObservationPipeline {
  private readonly file: string;
  private state: ObservationStoreState;
  private transition = Promise.resolve();

  private constructor(directory: string, state: ObservationStoreState) {
    this.file = path.join(directory, STORE_FILE);
    this.state = state;
  }

  static async open(directory: string): Promise<ObservationPipeline> {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, STORE_FILE);
    let state = emptyState();
    try {
      state = parseState(JSON.parse(await readFile(file, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return new ObservationPipeline(directory, state);
  }

  append(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    return this.mutate((state) => {
      const known = new Set(state.envelopes.map((envelope) => envelope.envelopeId));
      for (const envelope of envelopes) {
        if (!isObservationEnvelope(envelope)) throw new Error('Cannot append an invalid envelope');
        if (known.has(envelope.envelopeId)) continue;
        known.add(envelope.envelopeId);
        state.envelopes.push(structuredClone(envelope));
      }
      state.envelopes.sort(
        (left, right) =>
          left.identity.sequence - right.identity.sequence ||
          left.envelopeId.localeCompare(right.envelopeId),
      );
    });
  }

  async pending(destinationId: string, limit = 256): Promise<readonly ObservationEnvelope[]> {
    await this.transition;
    const destination = destinationId.trim();
    if (!destination) throw new Error('Observation destination id is required');
    const cursor = this.state.cursors[destination] ?? null;
    const cursorIndex =
      cursor === null
        ? -1
        : this.state.envelopes.findIndex((envelope) => envelope.envelopeId === cursor);
    if (cursor !== null && cursorIndex < 0) {
      throw new Error(`Observation cursor is outside retained history: ${destination}`);
    }
    return structuredClone(this.state.envelopes.slice(cursorIndex + 1, cursorIndex + 1 + limit));
  }

  acknowledge(destinationId: string, envelopeId: string): Promise<void> {
    return this.mutate((state) => {
      const destination = destinationId.trim();
      if (!destination) throw new Error('Observation destination id is required');
      const nextIndex = state.envelopes.findIndex((item) => item.envelopeId === envelopeId);
      if (nextIndex < 0) throw new Error('Cannot acknowledge an unknown observation envelope');
      const current = state.cursors[destination] ?? null;
      const currentIndex =
        current === null ? -1 : state.envelopes.findIndex((item) => item.envelopeId === current);
      if (nextIndex < currentIndex) return;
      state.cursors[destination] = envelopeId;
    });
  }

  private mutate(operation: (state: ObservationStoreState) => void | Promise<void>): Promise<void> {
    let resolveResult!: () => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<void>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.transition = this.transition.then(async () => {
      try {
        const next = structuredClone(this.state);
        await operation(next);
        await this.persist(next);
        this.state = next;
        resolveResult();
      } catch (error) {
        rejectResult(error);
      }
    });
    return result;
  }

  private async persist(state: ObservationStoreState): Promise<void> {
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, this.file);
  }
}
