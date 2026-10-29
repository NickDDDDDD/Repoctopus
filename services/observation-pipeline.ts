import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isObservationEnvelope,
  type ObservationEnvelope,
} from '../domains/trajectory/observation.js';

export type ObservationDestinationMode = 'enabled' | 'paused' | 'removed';

export interface ObservationDestinationAttempt {
  result: 'succeeded' | 'failed';
  attemptedAt: string;
  warningCode?: string;
}

interface ObservationDestinationState {
  mode: ObservationDestinationMode;
  cursor: string | null;
  cursorPosition: number;
  gap: { droppedEnvelopes: number; firstRetainedSequence: number | null } | null;
  lastAttempt: ObservationDestinationAttempt | null;
}

interface ObservationStoreState {
  schemaVersion: 2;
  envelopes: ObservationEnvelope[];
  positions: Record<string, number>;
  nextPosition: number;
  droppedEnvelopes: number;
  destinations: Record<string, ObservationDestinationState>;
}

export interface ObservationDestinationStatus extends ObservationDestinationState {
  destinationId: string;
  backlog: number;
  retained: number;
}

const STORE_FILE = 'observation-envelopes.json';

function emptyState(): ObservationStoreState {
  return {
    schemaVersion: 2,
    envelopes: [],
    positions: {},
    nextPosition: 0,
    droppedEnvelopes: 0,
    destinations: {},
  };
}

function parseState(value: unknown): ObservationStoreState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Observation Store state is not an object');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.envelopes)) {
    throw new Error('Observation Store schema is unsupported');
  }
  if (!candidate.envelopes.every(isObservationEnvelope)) {
    throw new Error('Observation Store contains an invalid envelope');
  }
  if (
    typeof candidate.positions !== 'object' ||
    candidate.positions === null ||
    Array.isArray(candidate.positions) ||
    !Number.isSafeInteger(candidate.nextPosition) ||
    (candidate.nextPosition as number) < 0 ||
    !Number.isSafeInteger(candidate.droppedEnvelopes) ||
    (candidate.droppedEnvelopes as number) < 0
  ) {
    throw new Error('Observation Store contains invalid append positions');
  }
  const positions = candidate.positions as Record<string, unknown>;
  if (
    candidate.envelopes.some((envelope) => !Number.isSafeInteger(positions[envelope.envelopeId]))
  ) {
    throw new Error('Observation Store is missing an envelope append position');
  }
  if (
    typeof candidate.destinations !== 'object' ||
    candidate.destinations === null ||
    Array.isArray(candidate.destinations)
  ) {
    throw new Error('Observation Store contains invalid destinations');
  }
  const destinations: Record<string, ObservationDestinationState> = {};
  for (const [destination, rawState] of Object.entries(
    candidate.destinations as Record<string, unknown>,
  )) {
    const value = rawState as Partial<ObservationDestinationState> | null;
    if (
      !destination.trim() ||
      !value ||
      !['enabled', 'paused', 'removed'].includes(value.mode ?? '') ||
      (value.cursor !== null && typeof value.cursor !== 'string') ||
      !Number.isSafeInteger(value.cursorPosition) ||
      (value.cursorPosition ?? -2) < -1 ||
      !('gap' in value) ||
      !('lastAttempt' in value)
    ) {
      throw new Error('Observation Store contains an invalid destination state');
    }
    destinations[destination] = value as ObservationDestinationState;
  }
  return {
    schemaVersion: 2,
    envelopes: candidate.envelopes,
    positions: positions as Record<string, number>,
    nextPosition: candidate.nextPosition as number,
    droppedEnvelopes: candidate.droppedEnvelopes as number,
    destinations,
  };
}

/** Durable immutable-envelope store with one acknowledgement cursor per destination. */
export class ObservationPipeline {
  private readonly file: string;
  private state: ObservationStoreState;
  private transition = Promise.resolve();
  private readonly capacity: number;

  private constructor(directory: string, state: ObservationStoreState, capacity: number) {
    this.file = path.join(directory, STORE_FILE);
    this.state = state;
    this.capacity = capacity;
  }

  static async open(
    directory: string,
    options: { capacity?: number } = {},
  ): Promise<ObservationPipeline> {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, STORE_FILE);
    let state = emptyState();
    try {
      state = parseState(JSON.parse(await readFile(file, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const capacity = options.capacity ?? 10_000;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Observation retention capacity must be a positive integer');
    }
    return new ObservationPipeline(directory, state, capacity);
  }

  append(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    return this.mutate((state) => {
      const known = new Set(state.envelopes.map((envelope) => envelope.envelopeId));
      for (const envelope of envelopes) {
        if (!isObservationEnvelope(envelope)) throw new Error('Cannot append an invalid envelope');
        if (known.has(envelope.envelopeId)) continue;
        known.add(envelope.envelopeId);
        state.envelopes.push(structuredClone(envelope));
        state.positions[envelope.envelopeId] = state.nextPosition;
        state.nextPosition += 1;
      }
      const overflow = Math.max(0, state.envelopes.length - this.capacity);
      if (overflow === 0) return;
      const dropped = state.envelopes.splice(0, overflow);
      state.droppedEnvelopes += dropped.length;
      const firstRetainedSequence = state.envelopes[0]?.identity.sequence ?? null;
      for (const destination of Object.values(state.destinations)) {
        if (destination.mode === 'removed') continue;
        const missed = dropped.filter(
          (envelope) => state.positions[envelope.envelopeId]! > destination.cursorPosition,
        ).length;
        if (missed === 0) continue;
        destination.gap = {
          droppedEnvelopes: (destination.gap?.droppedEnvelopes ?? 0) + missed,
          firstRetainedSequence,
        };
      }
      for (const envelope of dropped) delete state.positions[envelope.envelopeId];
    });
  }

  configureDestination(destinationId: string, mode: ObservationDestinationMode): Promise<void> {
    return this.mutate((state) => {
      const destination = this.destinationId(destinationId);
      const current = state.destinations[destination];
      state.destinations[destination] = current
        ? { ...current, mode }
        : {
            mode,
            cursor: null,
            cursorPosition: -1,
            gap:
              state.droppedEnvelopes > 0
                ? {
                    droppedEnvelopes: state.droppedEnvelopes,
                    firstRetainedSequence: state.envelopes[0]?.identity.sequence ?? null,
                  }
                : null,
            lastAttempt: null,
          };
    });
  }

  async pending(destinationId: string, limit = 256): Promise<readonly ObservationEnvelope[]> {
    await this.transition;
    const destination = destinationId.trim();
    if (!destination) throw new Error('Observation destination id is required');
    const current = this.state.destinations[destination];
    if (current?.mode === 'paused' || current?.mode === 'removed') return [];
    const cursorPosition = current?.cursorPosition ?? -1;
    return structuredClone(
      this.state.envelopes
        .filter((envelope) => this.state.positions[envelope.envelopeId]! > cursorPosition)
        .slice(0, limit),
    );
  }

  acknowledge(destinationId: string, envelopeId: string): Promise<void> {
    return this.mutate((state) => {
      const destination = this.destinationId(destinationId);
      const nextIndex = state.envelopes.findIndex((item) => item.envelopeId === envelopeId);
      if (nextIndex < 0) throw new Error('Cannot acknowledge an unknown observation envelope');
      const next = state.envelopes[nextIndex]!;
      const nextPosition = state.positions[next.envelopeId]!;
      const current = state.destinations[destination] ?? {
        mode: 'enabled' as const,
        cursor: null,
        cursorPosition: -1,
        gap: null,
        lastAttempt: null,
      };
      if (nextPosition < current.cursorPosition) return;
      state.destinations[destination] = {
        ...current,
        cursor: envelopeId,
        cursorPosition: nextPosition,
      };
    });
  }

  recordAttempt(destinationId: string, attempt: ObservationDestinationAttempt): Promise<void> {
    return this.mutate((state) => {
      const destination = this.destinationId(destinationId);
      const current = state.destinations[destination] ?? {
        mode: 'enabled' as const,
        cursor: null,
        cursorPosition: -1,
        gap: null,
        lastAttempt: null,
      };
      state.destinations[destination] = { ...current, lastAttempt: structuredClone(attempt) };
    });
  }

  async status(destinationId: string): Promise<ObservationDestinationStatus> {
    await this.transition;
    const destination = this.destinationId(destinationId);
    const current = this.state.destinations[destination] ?? {
      mode: 'enabled' as const,
      cursor: null,
      cursorPosition: -1,
      gap: null,
      lastAttempt: null,
    };
    const backlog =
      current.mode === 'removed'
        ? 0
        : this.state.envelopes.filter(
            (envelope) => this.state.positions[envelope.envelopeId]! > current.cursorPosition,
          ).length;
    return structuredClone({
      destinationId: destination,
      ...current,
      backlog,
      retained: this.state.envelopes.length,
    });
  }

  private destinationId(value: string): string {
    const destination = value.trim();
    if (!destination) throw new Error('Observation destination id is required');
    return destination;
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
