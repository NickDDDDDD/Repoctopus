import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  validateObservationEnvelope,
  type ObservationEnvelope,
} from '../../domains/telemetry/observation-envelope.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export interface ObservationDestinationCursor {
  schemaVersion: 1;
  destinationId: string;
  acknowledged: Record<string, string>;
  health: {
    status: 'healthy' | 'degraded';
    consecutiveFailures: number;
    lastFailureAt?: string;
    lastFailureCode?: string;
  };
  updatedAt: string;
}

export interface ObservationEnvelopeStoreHooks {
  beforeEnvelopeCommit?: (envelope: ObservationEnvelope) => void | Promise<void>;
  beforeCursorCommit?: (cursor: ObservationDestinationCursor) => void | Promise<void>;
}

const DESTINATION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const FAILURE_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,7}$/u;

async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertDestinationId(destinationId: string): void {
  if (!DESTINATION_ID.test(destinationId) || destinationId.length > 128) {
    throw new Error(`Invalid observation destination id: ${destinationId}`);
  }
}

function assertTimestamp(timestamp: string): void {
  if (Number.isNaN(Date.parse(timestamp))) throw new Error('Invalid cursor timestamp');
}

function emptyCursor(destinationId: string): ObservationDestinationCursor {
  return {
    schemaVersion: 1,
    destinationId,
    acknowledged: {},
    health: { status: 'healthy', consecutiveFailures: 0 },
    updatedAt: new Date(0).toISOString(),
  };
}

function validateCursor(
  value: unknown,
  expectedDestinationId: string,
): ObservationDestinationCursor {
  if (!value || typeof value !== 'object') throw new Error('Invalid observation cursor');
  const cursor = value as ObservationDestinationCursor;
  if (
    cursor.schemaVersion !== 1 ||
    cursor.destinationId !== expectedDestinationId ||
    !cursor.acknowledged ||
    typeof cursor.acknowledged !== 'object' ||
    Array.isArray(cursor.acknowledged) ||
    !cursor.health ||
    typeof cursor.health !== 'object' ||
    !['healthy', 'degraded'].includes(cursor.health.status) ||
    !Number.isSafeInteger(cursor.health.consecutiveFailures) ||
    cursor.health.consecutiveFailures < 0
  ) {
    throw new Error(`Invalid observation cursor: ${expectedDestinationId}`);
  }
  assertTimestamp(cursor.updatedAt);
  for (const [envelopeId, digest] of Object.entries(cursor.acknowledged)) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(envelopeId) || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Invalid observation cursor acknowledgement: ${expectedDestinationId}`);
    }
  }
  if (cursor.health.status === 'healthy' && cursor.health.consecutiveFailures !== 0) {
    throw new Error(`Invalid healthy observation cursor: ${expectedDestinationId}`);
  }
  if (cursor.health.status === 'degraded') {
    if (
      cursor.health.consecutiveFailures < 1 ||
      !cursor.health.lastFailureAt ||
      !cursor.health.lastFailureCode ||
      !FAILURE_CODE.test(cursor.health.lastFailureCode)
    ) {
      throw new Error(`Invalid degraded observation cursor: ${expectedDestinationId}`);
    }
    assertTimestamp(cursor.health.lastFailureAt);
  }
  return cursor;
}

export class FileObservationEnvelopeStore {
  private readonly writes = new Map<string, Promise<void>>();

  constructor(
    private readonly workspace: string,
    private readonly hooks: ObservationEnvelopeStoreHooks = {},
  ) {}

  private root(...segments: string[]): string {
    return path.join(this.workspace, '.repoctopus', 'telemetry', 'v1', ...segments);
  }

  private envelopeFile(envelopeId: string): string {
    return this.root('envelopes', `${envelopeId.slice('sha256:'.length)}.json`);
  }

  private cursorFile(destinationId: string): string {
    return this.root('destinations', `${destinationId}.json`);
  }

  private async serializeCursorWrite<T>(
    destinationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writes.get(destinationId) ?? Promise.resolve();
    let resolveCurrent: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    this.writes.set(destinationId, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      resolveCurrent();
      if (this.writes.get(destinationId) === current) this.writes.delete(destinationId);
    }
  }

  async save(envelope: ObservationEnvelope): Promise<void> {
    validateObservationEnvelope(envelope);
    const file = this.envelopeFile(envelope.envelopeId);
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await atomicWriteJson(file, envelope, {
        exclusive: true,
        beforeCommit: () => this.hooks.beforeEnvelopeCommit?.(envelope),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await this.load(envelope.envelopeId);
      if (!current || canonicalJson(current) !== canonicalJson(envelope)) {
        throw new Error(`Conflicting observation envelope: ${envelope.envelopeId}`, {
          cause: error,
        });
      }
    }
  }

  async load(envelopeId: string): Promise<ObservationEnvelope | null> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(envelopeId)) throw new Error('Invalid envelope id');
    const value = await optionalJson(this.envelopeFile(envelopeId));
    if (value === null) return null;
    validateObservationEnvelope(value);
    if (value.envelopeId !== envelopeId)
      throw new Error(`Mismatched observation envelope: ${envelopeId}`);
    return value;
  }

  async list(): Promise<ObservationEnvelope[]> {
    let files: string[];
    try {
      files = await readdir(this.root('envelopes'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const envelopes = await Promise.all(
      files
        .filter((file) => /^[a-f0-9]{64}\.json$/u.test(file))
        .sort()
        .map((file) => this.load(`sha256:${file.slice(0, -'.json'.length)}`)),
    );
    return envelopes
      .filter((envelope): envelope is ObservationEnvelope => envelope !== null)
      .sort(
        (left, right) =>
          left.observedAt.localeCompare(right.observedAt) ||
          left.source.domain.localeCompare(right.source.domain) ||
          (left.source.sequence ?? Number.MAX_SAFE_INTEGER) -
            (right.source.sequence ?? Number.MAX_SAFE_INTEGER) ||
          left.source.eventId.localeCompare(right.source.eventId),
      );
  }

  async readCursor(destinationId: string): Promise<ObservationDestinationCursor> {
    assertDestinationId(destinationId);
    const value = await optionalJson(this.cursorFile(destinationId));
    return value === null ? emptyCursor(destinationId) : validateCursor(value, destinationId);
  }

  async pending(destinationId: string): Promise<ObservationEnvelope[]> {
    const [cursor, envelopes] = await Promise.all([this.readCursor(destinationId), this.list()]);
    return envelopes.filter(
      (envelope) => cursor.acknowledged[envelope.envelopeId] !== envelope.digest,
    );
  }

  async acknowledge(
    destinationId: string,
    envelope: ObservationEnvelope,
    updatedAt = new Date().toISOString(),
  ): Promise<ObservationDestinationCursor> {
    assertDestinationId(destinationId);
    validateObservationEnvelope(envelope);
    assertTimestamp(updatedAt);
    return this.serializeCursorWrite(destinationId, async () => {
      const stored = await this.load(envelope.envelopeId);
      if (!stored || stored.digest !== envelope.digest) {
        throw new Error(
          `Cannot acknowledge an unstored observation envelope: ${envelope.envelopeId}`,
        );
      }
      const current = await this.readCursor(destinationId);
      const next: ObservationDestinationCursor = {
        schemaVersion: 1,
        destinationId,
        acknowledged: {
          ...current.acknowledged,
          [envelope.envelopeId]: envelope.digest,
        },
        health: { status: 'healthy', consecutiveFailures: 0 },
        updatedAt: new Date(updatedAt).toISOString(),
      };
      await this.writeCursor(next);
      return next;
    });
  }

  async recordFailure(
    destinationId: string,
    failureCode: string,
    failedAt = new Date().toISOString(),
  ): Promise<ObservationDestinationCursor> {
    assertDestinationId(destinationId);
    if (!FAILURE_CODE.test(failureCode)) throw new Error('Invalid observation failure code');
    assertTimestamp(failedAt);
    return this.serializeCursorWrite(destinationId, async () => {
      const current = await this.readCursor(destinationId);
      const next: ObservationDestinationCursor = {
        ...current,
        health: {
          status: 'degraded',
          consecutiveFailures: current.health.consecutiveFailures + 1,
          lastFailureAt: new Date(failedAt).toISOString(),
          lastFailureCode: failureCode,
        },
        updatedAt: new Date(failedAt).toISOString(),
      };
      await this.writeCursor(next);
      return next;
    });
  }

  private async writeCursor(cursor: ObservationDestinationCursor): Promise<void> {
    validateCursor(cursor, cursor.destinationId);
    const file = this.cursorFile(cursor.destinationId);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteJson(file, cursor, {
      beforeCommit: () => this.hooks.beforeCursorCommit?.(cursor),
    });
  }
}
