import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertObservationEnvelopeIntegrity,
  type ObservationEnvelope,
} from '../../domains/telemetry/observation-envelope.js';
import type {
  ObservationAcknowledgement,
  ObservationDestinationCursor,
  ObservationDestinationGap,
  ObservationDestinationMode,
  ObservationDestinationSnapshot,
  ObservationEnvelopeStore,
  ObservationRetentionPolicy,
  ObservationRetentionResult,
  StoredObservationEnvelope,
} from '../../domains/telemetry/observation-store.js';
import {
  TELEMETRY_DESTINATION_KINDS,
  type TelemetryDestinationKind,
} from '../../domains/telemetry/pipeline-health.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { withRecoverableFileLock } from '../runtime/recoverable-file-lock.js';

interface PersistedObservationDestination {
  schemaVersion: 1;
  destinationId: string;
  destinationKind: TelemetryDestinationKind;
  mode: ObservationDestinationMode;
  cursor: ObservationDestinationCursor;
  nextOffset: number;
  gapCount: number;
  droppedCount: number;
  droppedBytes: number;
  completeHistory: boolean;
  changedAt: string;
}

interface ObservationStoreSnapshot {
  schemaVersion: 2;
  revision: number;
  nextOffset: number;
  entries: StoredObservationEnvelope[];
  destinations: PersistedObservationDestination[];
  gaps: ObservationDestinationGap[];
}

export interface ObservationEnvelopeStoreHooks {
  beforeEnvelopeCommit?: () => void | Promise<void>;
  afterEnvelopeCommit?: () => void | Promise<void>;
  beforeCursorCommit?: (destinationId: string) => void | Promise<void>;
  afterCursorCommit?: (destinationId: string) => void | Promise<void>;
  beforeDestinationCommit?: (destinationId: string) => void | Promise<void>;
  afterDestinationCommit?: (destinationId: string) => void | Promise<void>;
  retention?: ObservationRetentionPolicy;
  now?: () => Date;
}

const DESTINATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function destinationIdentity(value: string): string {
  if (!DESTINATION_ID.test(value)) throw new Error('Destination id must be a stable identity');
  return value;
}

function isoTimestamp(value: string, label: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateRetentionPolicy(policy: ObservationRetentionPolicy): ObservationRetentionPolicy {
  return {
    maxEntries: positiveInteger(policy.maxEntries, 'Observation retention maxEntries'),
    maxBytes: positiveInteger(policy.maxBytes, 'Observation retention maxBytes'),
    maxAgeMs: positiveInteger(policy.maxAgeMs, 'Observation retention maxAgeMs'),
  };
}

function entryBytes(entry: StoredObservationEnvelope): number {
  return Buffer.byteLength(JSON.stringify(entry.envelope), 'utf8');
}

function emptyCursor(destinationId: string): ObservationDestinationCursor {
  return {
    schemaVersion: 1,
    destinationId,
    acknowledgedOffset: 0,
    acknowledgedEnvelopeId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function validateCursor(
  value: unknown,
  destinationId: string,
  headOffset: number,
): ObservationDestinationCursor {
  if (!value || typeof value !== 'object') throw new Error('Observation Cursor is invalid');
  const cursor = value as ObservationDestinationCursor;
  if (
    cursor.schemaVersion !== 1 ||
    cursor.destinationId !== destinationId ||
    !Number.isSafeInteger(cursor.acknowledgedOffset) ||
    cursor.acknowledgedOffset < 0 ||
    cursor.acknowledgedOffset > headOffset ||
    (cursor.acknowledgedEnvelopeId !== null && !DIGEST.test(cursor.acknowledgedEnvelopeId)) ||
    (cursor.acknowledgedOffset === 0) !== (cursor.acknowledgedEnvelopeId === null) ||
    !Number.isFinite(Date.parse(cursor.updatedAt))
  ) {
    throw new Error(`Observation Cursor is invalid for ${destinationId}`);
  }
  return cursor;
}

function validateDestination(
  value: PersistedObservationDestination,
  headOffset: number,
): PersistedObservationDestination {
  const destinationId = destinationIdentity(value.destinationId);
  if (
    value.schemaVersion !== 1 ||
    !TELEMETRY_DESTINATION_KINDS.includes(value.destinationKind) ||
    !(['enabled', 'paused', 'removed'] as const).includes(value.mode) ||
    !Number.isSafeInteger(value.nextOffset) ||
    value.nextOffset < 1 ||
    value.nextOffset > headOffset + 1 ||
    !Number.isSafeInteger(value.gapCount) ||
    value.gapCount < 0 ||
    !Number.isSafeInteger(value.droppedCount) ||
    value.droppedCount < 0 ||
    !Number.isSafeInteger(value.droppedBytes) ||
    value.droppedBytes < 0 ||
    typeof value.completeHistory !== 'boolean'
  ) {
    throw new Error(`Observation Destination is invalid for ${destinationId}`);
  }
  isoTimestamp(value.changedAt, 'Destination change time');
  validateCursor(value.cursor, destinationId, headOffset);
  return value;
}

function validateGap(value: ObservationDestinationGap, headOffset: number): void {
  const destinationId = destinationIdentity(value.destinationId);
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.fromOffset) ||
    value.fromOffset < 1 ||
    !Number.isSafeInteger(value.toOffset) ||
    value.toOffset < value.fromOffset ||
    value.toOffset > headOffset ||
    value.droppedCount !== value.toOffset - value.fromOffset + 1 ||
    !Number.isSafeInteger(value.droppedBytes) ||
    value.droppedBytes < 1
  ) {
    throw new Error(`Observation Destination gap is invalid for ${destinationId}`);
  }
  isoTimestamp(value.recordedAt, 'Destination gap time');
}

function validateSnapshot(value: unknown): ObservationStoreSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Observation Store is invalid');
  const snapshot = value as ObservationStoreSnapshot;
  if (
    snapshot.schemaVersion !== 2 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Number.isSafeInteger(snapshot.nextOffset) ||
    snapshot.nextOffset < 1 ||
    !Array.isArray(snapshot.entries) ||
    !Array.isArray(snapshot.destinations) ||
    !Array.isArray(snapshot.gaps)
  ) {
    throw new Error('Observation Store snapshot is invalid');
  }
  const identities = new Set<string>();
  let previousOffset = snapshot.entries[0]?.offset ? snapshot.entries[0].offset - 1 : 0;
  for (const entry of snapshot.entries) {
    if (
      entry.schemaVersion !== 1 ||
      !Number.isSafeInteger(entry.offset) ||
      entry.offset !== previousOffset + 1 ||
      entry.offset >= snapshot.nextOffset
    ) {
      throw new Error('Observation Store retained offsets are not contiguous');
    }
    previousOffset = entry.offset;
    assertObservationEnvelopeIntegrity(entry.envelope);
    if (identities.has(entry.envelope.envelopeId)) {
      throw new Error('Observation Store contains a duplicate envelope identity');
    }
    identities.add(entry.envelope.envelopeId);
  }
  if (snapshot.entries.length > 0 && previousOffset !== snapshot.nextOffset - 1) {
    throw new Error('Observation Store retained head does not match nextOffset');
  }
  const destinationIds = new Set<string>();
  for (const destination of snapshot.destinations) {
    validateDestination(destination, snapshot.nextOffset - 1);
    if (destinationIds.has(destination.destinationId)) {
      throw new Error('Observation Store contains a duplicate Destination identity');
    }
    destinationIds.add(destination.destinationId);
  }
  for (const gap of snapshot.gaps) {
    validateGap(gap, snapshot.nextOffset - 1);
    if (!destinationIds.has(gap.destinationId)) {
      throw new Error(`Observation gap references an unknown Destination: ${gap.destinationId}`);
    }
  }
  return snapshot;
}

function findDestination(
  snapshot: ObservationStoreSnapshot,
  destinationId: string,
): PersistedObservationDestination {
  const identity = destinationIdentity(destinationId);
  const destination = snapshot.destinations.find(
    (candidate) => candidate.destinationId === identity,
  );
  if (!destination) throw new Error(`Observation Destination is not registered: ${identity}`);
  return destination;
}

function assertForwardTime(previous: string, next: string, label: string): string {
  const normalized = isoTimestamp(next, label);
  if (Date.parse(normalized) < Date.parse(previous)) {
    throw new Error(`${label} cannot move backwards`);
  }
  return normalized;
}

function applyRetention(
  current: ObservationStoreSnapshot,
  policyInput: ObservationRetentionPolicy,
  evaluatedAtInput: string,
): { snapshot: ObservationStoreSnapshot; result: ObservationRetentionResult } {
  const policy = validateRetentionPolicy(policyInput);
  const evaluatedAt = isoTimestamp(evaluatedAtInput, 'Retention evaluation time');
  const entries = [...current.entries];
  const dropped: StoredObservationEnvelope[] = [];
  let retainedBytes = entries.reduce((total, entry) => total + entryBytes(entry), 0);
  const overAge = () =>
    entries.some(
      (entry) =>
        Date.parse(evaluatedAt) - Date.parse(entry.envelope.source.observedAt) > policy.maxAgeMs,
    );
  while (
    entries.length > 0 &&
    (entries.length > policy.maxEntries || retainedBytes > policy.maxBytes || overAge())
  ) {
    const entry = entries.shift()!;
    dropped.push(entry);
    retainedBytes -= entryBytes(entry);
  }
  if (dropped.length === 0) {
    return {
      snapshot: current,
      result: {
        retainedCount: entries.length,
        retainedBytes,
        droppedCount: 0,
        droppedBytes: 0,
        gaps: [],
      },
    };
  }
  const gaps: ObservationDestinationGap[] = [];
  const destinations = current.destinations.map((destination) => {
    if (destination.mode === 'removed') {
      return { ...destination, nextOffset: current.nextOffset };
    }
    const lost = dropped.filter((entry) => entry.offset >= destination.nextOffset);
    if (lost.length === 0) return destination;
    const droppedBytes = lost.reduce((total, entry) => total + entryBytes(entry), 0);
    const gap: ObservationDestinationGap = {
      schemaVersion: 1,
      destinationId: destination.destinationId,
      fromOffset: lost[0]!.offset,
      toOffset: lost.at(-1)!.offset,
      droppedCount: lost.length,
      droppedBytes,
      recordedAt: evaluatedAt,
    };
    gaps.push(gap);
    return {
      ...destination,
      nextOffset: gap.toOffset + 1,
      gapCount: destination.gapCount + 1,
      droppedCount: destination.droppedCount + gap.droppedCount,
      droppedBytes: destination.droppedBytes + gap.droppedBytes,
      completeHistory: false,
    };
  });
  const droppedBytes = dropped.reduce((total, entry) => total + entryBytes(entry), 0);
  return {
    snapshot: {
      ...current,
      revision: current.revision + 1,
      entries,
      destinations,
      gaps: [...current.gaps, ...gaps],
    },
    result: {
      retainedCount: entries.length,
      retainedBytes,
      droppedCount: dropped.length,
      droppedBytes,
      gaps,
    },
  };
}

export class FileObservationEnvelopeStore implements ObservationEnvelopeStore {
  readonly #root: string;

  constructor(
    workspace: string,
    private readonly hooks: ObservationEnvelopeStoreHooks = {},
  ) {
    this.#root = path.join(path.resolve(workspace), '.repoctopus', 'telemetry', 'envelopes-v2');
    if (hooks.retention) validateRetentionPolicy(hooks.retention);
  }

  private storeFile(): string {
    return path.join(this.#root, 'store.json');
  }

  private storeLock(): string {
    return path.join(this.#root, 'store.lock');
  }

  private async snapshot(): Promise<ObservationStoreSnapshot> {
    const value = await optionalJson(this.storeFile());
    return value === null
      ? {
          schemaVersion: 2,
          revision: 0,
          nextOffset: 1,
          entries: [],
          destinations: [],
          gaps: [],
        }
      : validateSnapshot(value);
  }

  private now(): string {
    return (this.hooks.now ?? (() => new Date()))().toISOString();
  }

  private pendingEntries(
    snapshot: ObservationStoreSnapshot,
    destination: PersistedObservationDestination,
  ): StoredObservationEnvelope[] {
    if (destination.mode === 'removed') return [];
    return snapshot.entries.filter((entry) => entry.offset >= destination.nextOffset);
  }

  private projectDestination(
    snapshot: ObservationStoreSnapshot,
    destination: PersistedObservationDestination,
    observedAtInput: string,
  ): ObservationDestinationSnapshot {
    const observedAt = isoTimestamp(observedAtInput, 'Destination observation time');
    const pending = this.pendingEntries(snapshot, destination);
    const bytes = pending.reduce((total, entry) => total + entryBytes(entry), 0);
    const oldestAgeMs = pending[0]
      ? Math.max(0, Date.parse(observedAt) - Date.parse(pending[0].envelope.source.observedAt))
      : 0;
    return {
      schemaVersion: 1,
      destination: { id: destination.destinationId, kind: destination.destinationKind },
      mode: destination.mode,
      deliverySemantics: 'at-least-once-replay',
      cursor: structuredClone(destination.cursor),
      headOffset: snapshot.nextOffset - 1,
      cursorLag: snapshot.nextOffset - 1 - destination.cursor.acknowledgedOffset,
      nextOffset: destination.nextOffset,
      backlog: { count: pending.length, bytes, oldestAgeMs },
      gap: {
        count: destination.gapCount,
        droppedCount: destination.droppedCount,
        droppedBytes: destination.droppedBytes,
        completeHistory: destination.completeHistory,
      },
      changedAt: destination.changedAt,
    };
  }

  async append(envelope: ObservationEnvelope): Promise<StoredObservationEnvelope> {
    assertObservationEnvelopeIntegrity(envelope);
    return withRecoverableFileLock(this.storeLock(), async () => {
      const current = await this.snapshot();
      const existing = current.entries.find(
        (entry) => entry.envelope.envelopeId === envelope.envelopeId,
      );
      if (existing) {
        if (existing.envelope.canonicalDigest !== envelope.canonicalDigest) {
          throw new Error('Observation envelope identity collision has a different digest');
        }
        return existing;
      }
      const entry: StoredObservationEnvelope = {
        schemaVersion: 1,
        offset: current.nextOffset,
        envelope,
      };
      let next: ObservationStoreSnapshot = {
        ...current,
        revision: current.revision + 1,
        nextOffset: current.nextOffset + 1,
        entries: [...current.entries, entry],
        destinations: current.destinations.map((destination) =>
          destination.mode === 'removed'
            ? { ...destination, nextOffset: current.nextOffset + 1 }
            : destination,
        ),
      };
      if (this.hooks.retention) {
        next = applyRetention(next, this.hooks.retention, this.now()).snapshot;
      }
      await atomicWriteJson(this.storeFile(), next, {
        containedRoot: this.#root,
        ...(this.hooks.beforeEnvelopeCommit
          ? { beforeCommit: this.hooks.beforeEnvelopeCommit }
          : {}),
      });
      await this.hooks.afterEnvelopeCommit?.();
      return entry;
    });
  }

  async readAll(): Promise<readonly StoredObservationEnvelope[]> {
    return (await this.snapshot()).entries;
  }

  async readPending(
    destinationId: string,
    limit = Number.MAX_SAFE_INTEGER,
  ): Promise<readonly StoredObservationEnvelope[]> {
    destinationIdentity(destinationId);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('Observation pending read limit must be a positive integer');
    }
    const snapshot = await this.snapshot();
    const destination = findDestination(snapshot, destinationId);
    if (destination.mode !== 'enabled') return [];
    return this.pendingEntries(snapshot, destination).slice(0, limit);
  }

  async readCursor(destinationId: string): Promise<ObservationDestinationCursor> {
    const snapshot = await this.snapshot();
    return structuredClone(findDestination(snapshot, destinationId).cursor);
  }

  async acknowledge(input: ObservationAcknowledgement): Promise<ObservationDestinationCursor> {
    const destinationId = destinationIdentity(input.destinationId);
    if (!Number.isSafeInteger(input.offset) || input.offset <= 0) {
      throw new Error('Observation acknowledgement offset must be a positive integer');
    }
    if (!DIGEST.test(input.envelopeId)) {
      throw new Error('Observation acknowledgement envelope identity is invalid');
    }
    const acknowledgedAt = isoTimestamp(input.acknowledgedAt, 'Acknowledgement time');
    return withRecoverableFileLock(this.storeLock(), async () => {
      const current = await this.snapshot();
      const destination = findDestination(current, destinationId);
      if (
        input.offset === destination.cursor.acknowledgedOffset &&
        input.envelopeId === destination.cursor.acknowledgedEnvelopeId
      ) {
        return structuredClone(destination.cursor);
      }
      if (destination.mode !== 'enabled') {
        throw new Error(`Observation Destination is not enabled: ${destinationId}`);
      }
      if (input.offset !== destination.nextOffset) {
        throw new Error('Observation acknowledgement must advance the Cursor contiguously');
      }
      const stored = current.entries.find((entry) => entry.offset === input.offset);
      if (!stored || stored.envelope.envelopeId !== input.envelopeId) {
        throw new Error('Observation acknowledgement identity does not match the Store');
      }
      const nextCursor: ObservationDestinationCursor = {
        schemaVersion: 1,
        destinationId,
        acknowledgedOffset: input.offset,
        acknowledgedEnvelopeId: input.envelopeId,
        updatedAt: acknowledgedAt,
      };
      const next: ObservationStoreSnapshot = {
        ...current,
        revision: current.revision + 1,
        destinations: current.destinations.map((candidate) =>
          candidate.destinationId === destinationId
            ? { ...candidate, cursor: nextCursor, nextOffset: input.offset + 1 }
            : candidate,
        ),
      };
      await atomicWriteJson(this.storeFile(), next, {
        containedRoot: this.#root,
        beforeCommit: () => this.hooks.beforeCursorCommit?.(destinationId),
      });
      await this.hooks.afterCursorCommit?.(destinationId);
      return nextCursor;
    });
  }

  async enableDestination(input: {
    destinationId: string;
    destinationKind: TelemetryDestinationKind;
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot> {
    const destinationId = destinationIdentity(input.destinationId);
    if (!TELEMETRY_DESTINATION_KINDS.includes(input.destinationKind)) {
      throw new Error('Observation Destination kind is invalid');
    }
    return withRecoverableFileLock(this.storeLock(), async () => {
      const current = await this.snapshot();
      const existing = current.destinations.find(
        (candidate) => candidate.destinationId === destinationId,
      );
      const changedAt = existing
        ? assertForwardTime(existing.changedAt, input.changedAt, 'Destination change time')
        : isoTimestamp(input.changedAt, 'Destination change time');
      if (existing && existing.destinationKind !== input.destinationKind) {
        throw new Error(`Observation Destination kind cannot change: ${destinationId}`);
      }
      const destination: PersistedObservationDestination = existing
        ? {
            ...existing,
            mode: 'enabled',
            nextOffset: existing.mode === 'removed' ? current.nextOffset : existing.nextOffset,
            changedAt,
          }
        : {
            schemaVersion: 1,
            destinationId,
            destinationKind: input.destinationKind,
            mode: 'enabled',
            cursor: emptyCursor(destinationId),
            nextOffset: current.entries[0]?.offset ?? current.nextOffset,
            gapCount: 0,
            droppedCount: 0,
            droppedBytes: 0,
            completeHistory: true,
            changedAt,
          };
      const next: ObservationStoreSnapshot = {
        ...current,
        revision: current.revision + 1,
        destinations: existing
          ? current.destinations.map((candidate) =>
              candidate.destinationId === destinationId ? destination : candidate,
            )
          : [...current.destinations, destination],
      };
      await atomicWriteJson(this.storeFile(), next, {
        containedRoot: this.#root,
        beforeCommit: () => this.hooks.beforeDestinationCommit?.(destinationId),
      });
      await this.hooks.afterDestinationCommit?.(destinationId);
      return this.projectDestination(next, destination, changedAt);
    });
  }

  private async changeDestinationMode(input: {
    destinationId: string;
    mode: 'paused' | 'removed';
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot> {
    const destinationId = destinationIdentity(input.destinationId);
    return withRecoverableFileLock(this.storeLock(), async () => {
      const current = await this.snapshot();
      const existing = findDestination(current, destinationId);
      if (existing.mode === 'removed' && input.mode === 'paused') {
        throw new Error(`Removed Observation Destination cannot be paused: ${destinationId}`);
      }
      const changedAt = assertForwardTime(
        existing.changedAt,
        input.changedAt,
        'Destination change time',
      );
      const destination: PersistedObservationDestination = {
        ...existing,
        mode: input.mode,
        nextOffset: input.mode === 'removed' ? current.nextOffset : existing.nextOffset,
        changedAt,
      };
      const next: ObservationStoreSnapshot = {
        ...current,
        revision: current.revision + 1,
        destinations: current.destinations.map((candidate) =>
          candidate.destinationId === destinationId ? destination : candidate,
        ),
      };
      await atomicWriteJson(this.storeFile(), next, {
        containedRoot: this.#root,
        beforeCommit: () => this.hooks.beforeDestinationCommit?.(destinationId),
      });
      await this.hooks.afterDestinationCommit?.(destinationId);
      return this.projectDestination(next, destination, changedAt);
    });
  }

  pauseDestination(input: {
    destinationId: string;
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot> {
    return this.changeDestinationMode({ ...input, mode: 'paused' });
  }

  removeDestination(input: {
    destinationId: string;
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot> {
    return this.changeDestinationMode({ ...input, mode: 'removed' });
  }

  async readDestination(
    destinationId: string,
    observedAt = this.now(),
  ): Promise<ObservationDestinationSnapshot> {
    const snapshot = await this.snapshot();
    return this.projectDestination(snapshot, findDestination(snapshot, destinationId), observedAt);
  }

  async readGaps(destinationId: string): Promise<readonly ObservationDestinationGap[]> {
    const snapshot = await this.snapshot();
    findDestination(snapshot, destinationId);
    return snapshot.gaps
      .filter((gap) => gap.destinationId === destinationId)
      .map((gap) => structuredClone(gap));
  }

  async enforceRetention(
    policy: ObservationRetentionPolicy,
    evaluatedAt: string,
  ): Promise<ObservationRetentionResult> {
    return withRecoverableFileLock(this.storeLock(), async () => {
      const current = await this.snapshot();
      const retained = applyRetention(current, policy, evaluatedAt);
      if (retained.snapshot !== current) {
        await atomicWriteJson(this.storeFile(), retained.snapshot, {
          containedRoot: this.#root,
          ...(this.hooks.beforeEnvelopeCommit
            ? { beforeCommit: this.hooks.beforeEnvelopeCommit }
            : {}),
        });
        await this.hooks.afterEnvelopeCommit?.();
      }
      return retained.result;
    });
  }
}
