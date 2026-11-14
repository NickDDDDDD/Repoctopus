import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isObservationEnvelope,
  type ObservationEnvelope,
} from '../domains/trajectory/observation.js';
import { atomicWriteText } from '../platform/filesystem/atomic-write.js';
import { withRecoverableFileLock } from '../platform/runtime/recoverable-file-lock.js';

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
  activeSignals?: readonly ObservationSignal[];
  signals?: Partial<Record<ObservationSignal, SignalCursor>>;
}

export type ObservationSignal = 'trace' | 'log' | 'metric';
type SignalCursor = Pick<
  ObservationDestinationState,
  'cursor' | 'cursorPosition' | 'lastAttempt'
> & {
  rejectedRecords: number;
};

export interface PendingObservation {
  envelope: ObservationEnvelope;
  position: number;
}

function destinationCursor(destination: ObservationDestinationState) {
  const cursors = destination.activeSignals?.map(
    (signal) => destination.signals?.[signal] ?? destination,
  );
  return (
    cursors?.sort((left, right) => left.cursorPosition - right.cursorPosition)[0] ?? destination
  );
}

function newDestination(): ObservationDestinationState {
  return { mode: 'enabled', cursor: null, cursorPosition: -1, gap: null, lastAttempt: null };
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

/** Durable immutable envelopes with acknowledgements per destination and signal. */
export class ObservationPipeline {
  private readonly file: string;

  private constructor(
    directory: string,
    private readonly capacity: number,
  ) {
    this.file = path.join(directory, STORE_FILE);
  }

  static async open(
    directory: string,
    options: { capacity?: number } = {},
  ): Promise<ObservationPipeline> {
    await mkdir(directory, { recursive: true });
    const capacity = options.capacity ?? 10_000;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Observation retention capacity must be a positive integer');
    }
    const pipeline = new ObservationPipeline(directory, capacity);
    await pipeline.readState();
    return pipeline;
  }

  append(envelopes: readonly ObservationEnvelope[]): Promise<void> {
    return this.mutate((state) => {
      const previousPosition = state.nextPosition;
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
      if (overflow === 0) return state.nextPosition !== previousPosition;
      const dropped = state.envelopes.splice(0, overflow);
      state.droppedEnvelopes += dropped.length;
      const firstRetainedSequence = state.envelopes[0]?.identity.sequence ?? null;
      for (const destination of Object.values(state.destinations)) {
        if (destination.mode === 'removed') continue;
        const missed = dropped.filter(
          (envelope) =>
            state.positions[envelope.envelopeId]! > destinationCursor(destination).cursorPosition,
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
      if (current?.mode === mode) return false;
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
    return (await this.pendingSignal(destinationId, undefined, limit)).map(
      ({ envelope }) => envelope,
    );
  }

  async pendingSignal(
    destinationId: string,
    signal?: ObservationSignal,
    limit = 256,
  ): Promise<readonly PendingObservation[]> {
    const state = await this.readState();
    const current = state.destinations[this.destinationId(destinationId)] ?? newDestination();
    if (current.mode !== 'enabled') return [];
    const cursor = signal ? (current.signals?.[signal] ?? current) : destinationCursor(current);
    return state.envelopes
      .map((envelope) => ({ envelope, position: state.positions[envelope.envelopeId]! }))
      .filter(({ position }) => position > cursor.cursorPosition)
      .slice(0, limit);
  }

  withReplayLock<T>(destinationId: string, action: () => Promise<T>): Promise<T> {
    const key = createHash('sha256')
      .update(this.destinationId(destinationId))
      .digest('hex')
      .slice(0, 16);
    return withRecoverableFileLock(`${this.file}.${key}.lock`, action);
  }

  setActiveSignals(destinationId: string, signals: readonly ObservationSignal[]): Promise<void> {
    return this.mutate((state) => {
      const id = this.destinationId(destinationId);
      const current = state.destinations[id] ?? newDestination();
      if (current.activeSignals?.join(',') === signals.join(',')) return false;
      state.destinations[id] = { ...current, activeSignals: signals };
    });
  }

  recordSignalAttempt(
    destinationId: string,
    signal: ObservationSignal,
    attempt: ObservationDestinationAttempt,
    confirmed?: PendingObservation,
    rejectedRecords = 0,
  ): Promise<void> {
    return this.mutate((state) => {
      const id = this.destinationId(destinationId);
      const current = state.destinations[id] ?? newDestination();
      const previous = current.signals?.[signal] ?? current;
      state.destinations[id] = {
        ...current,
        signals: {
          ...current.signals,
          [signal]: {
            cursor: confirmed?.envelope.envelopeId ?? previous.cursor,
            cursorPosition: confirmed?.position ?? previous.cursorPosition,
            lastAttempt: attempt,
            rejectedRecords: (current.signals?.[signal]?.rejectedRecords ?? 0) + rejectedRecords,
          },
        },
      };
    });
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
    const state = await this.readState();
    const destination = this.destinationId(destinationId);
    const current = state.destinations[destination] ?? newDestination();
    const { cursor, cursorPosition } = destinationCursor(current);
    const backlog =
      current.mode === 'removed'
        ? 0
        : state.envelopes.filter(
            (envelope) => state.positions[envelope.envelopeId]! > cursorPosition,
          ).length;
    return structuredClone({
      destinationId: destination,
      ...current,
      cursor,
      cursorPosition,
      backlog,
      retained: state.envelopes.length,
    });
  }

  private destinationId(value: string): string {
    const destination = value.trim();
    if (!destination) throw new Error('Observation destination id is required');
    return destination;
  }

  private mutate(operation: (state: ObservationStoreState) => void | boolean): Promise<void> {
    return withRecoverableFileLock(`${this.file}.lock`, async () => {
      const state = await this.readState();
      if (operation(state) === false) return;
      await atomicWriteText(this.file, `${JSON.stringify(state)}\n`);
    });
  }

  private async readState(): Promise<ObservationStoreState> {
    try {
      return parseState(JSON.parse(await readFile(this.file, 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw error;
    }
  }
}
