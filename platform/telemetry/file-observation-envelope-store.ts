import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertObservationEnvelopeIntegrity,
  type ObservationEnvelope,
} from '../../domains/telemetry/observation-envelope.js';
import type {
  ObservationAcknowledgement,
  ObservationDestinationCursor,
  ObservationEnvelopeStore,
  StoredObservationEnvelope,
} from '../../domains/telemetry/observation-store.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { withRecoverableFileLock } from '../runtime/recoverable-file-lock.js';

interface ObservationStoreSnapshot {
  schemaVersion: 1;
  revision: number;
  entries: StoredObservationEnvelope[];
}

export interface ObservationEnvelopeStoreHooks {
  beforeEnvelopeCommit?: () => void | Promise<void>;
  afterEnvelopeCommit?: () => void | Promise<void>;
  beforeCursorCommit?: (destinationId: string) => void | Promise<void>;
  afterCursorCommit?: (destinationId: string) => void | Promise<void>;
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

function validateSnapshot(value: unknown): ObservationStoreSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Observation Store is invalid');
  const snapshot = value as ObservationStoreSnapshot;
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !Array.isArray(snapshot.entries) ||
    snapshot.revision !== snapshot.entries.length
  ) {
    throw new Error('Observation Store snapshot is invalid');
  }
  const identities = new Set<string>();
  for (const [index, entry] of snapshot.entries.entries()) {
    if (entry.schemaVersion !== 1 || entry.offset !== index + 1) {
      throw new Error('Observation Store offsets are not contiguous');
    }
    assertObservationEnvelopeIntegrity(entry.envelope);
    if (identities.has(entry.envelope.envelopeId)) {
      throw new Error('Observation Store contains a duplicate envelope identity');
    }
    identities.add(entry.envelope.envelopeId);
  }
  return snapshot;
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

export class FileObservationEnvelopeStore implements ObservationEnvelopeStore {
  readonly #root: string;

  constructor(
    workspace: string,
    private readonly hooks: ObservationEnvelopeStoreHooks = {},
  ) {
    this.#root = path.join(path.resolve(workspace), '.repoctopus', 'telemetry', 'envelopes-v1');
  }

  private storeFile(): string {
    return path.join(this.#root, 'store.json');
  }

  private storeLock(): string {
    return path.join(this.#root, 'store.lock');
  }

  private cursorKey(destinationId: string): string {
    return createHash('sha256').update(destinationIdentity(destinationId)).digest('hex');
  }

  private cursorFile(destinationId: string): string {
    return path.join(this.#root, 'cursors', `${this.cursorKey(destinationId)}.json`);
  }

  private cursorLock(destinationId: string): string {
    return path.join(this.#root, 'cursors', `${this.cursorKey(destinationId)}.lock`);
  }

  private async snapshot(): Promise<ObservationStoreSnapshot> {
    const value = await optionalJson(this.storeFile());
    return value === null
      ? { schemaVersion: 1, revision: 0, entries: [] }
      : validateSnapshot(value);
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
        offset: current.entries.length + 1,
        envelope,
      };
      const next: ObservationStoreSnapshot = {
        schemaVersion: 1,
        revision: current.revision + 1,
        entries: [...current.entries, entry],
      };
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
    const cursor = await this.loadCursor(destinationId, snapshot);
    return snapshot.entries
      .filter((entry) => entry.offset > cursor.acknowledgedOffset)
      .slice(0, limit);
  }

  private async loadCursor(
    destinationId: string,
    snapshot: ObservationStoreSnapshot,
  ): Promise<ObservationDestinationCursor> {
    const value = await optionalJson(this.cursorFile(destinationId));
    if (value === null) {
      return {
        schemaVersion: 1,
        destinationId,
        acknowledgedOffset: 0,
        acknowledgedEnvelopeId: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const cursor = validateCursor(value, destinationId, snapshot.entries.length);
    if (
      cursor.acknowledgedOffset > 0 &&
      snapshot.entries[cursor.acknowledgedOffset - 1]?.envelope.envelopeId !==
        cursor.acknowledgedEnvelopeId
    ) {
      throw new Error(`Observation Cursor identity does not match Store for ${destinationId}`);
    }
    return cursor;
  }

  async readCursor(destinationId: string): Promise<ObservationDestinationCursor> {
    destinationIdentity(destinationId);
    return this.loadCursor(destinationId, await this.snapshot());
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
    return withRecoverableFileLock(this.cursorLock(destinationId), async () => {
      const snapshot = await this.snapshot();
      const current = await this.loadCursor(destinationId, snapshot);
      if (
        input.offset === current.acknowledgedOffset &&
        input.envelopeId === current.acknowledgedEnvelopeId
      ) {
        return current;
      }
      if (input.offset !== current.acknowledgedOffset + 1) {
        throw new Error('Observation acknowledgement must advance the Cursor contiguously');
      }
      const stored = snapshot.entries[input.offset - 1];
      if (!stored || stored.envelope.envelopeId !== input.envelopeId) {
        throw new Error('Observation acknowledgement identity does not match the Store');
      }
      const next: ObservationDestinationCursor = {
        schemaVersion: 1,
        destinationId,
        acknowledgedOffset: input.offset,
        acknowledgedEnvelopeId: input.envelopeId,
        updatedAt: acknowledgedAt,
      };
      await atomicWriteJson(this.cursorFile(destinationId), next, {
        containedRoot: this.#root,
        beforeCommit: () => this.hooks.beforeCursorCommit?.(destinationId),
      });
      await this.hooks.afterCursorCommit?.(destinationId);
      return next;
    });
  }
}
