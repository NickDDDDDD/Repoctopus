import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  validateObservationEnvelope,
  type ObservationEnvelope,
} from '../../domains/telemetry/observation-envelope.js';
import type {
  ObservationDestinationCursor,
  ObservationDestinationState,
  ObservationDestinationStatus,
  ObservationRetentionGap,
  ObservationRetentionPolicy,
} from '../../domains/telemetry/destination.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export type {
  ObservationDestinationCursor,
  ObservationDestinationState,
  ObservationDestinationStatus,
  ObservationRetentionGap,
  ObservationRetentionPolicy,
} from '../../domains/telemetry/destination.js';

export interface ObservationEnvelopeStoreHooks {
  beforeEnvelopeCommit?: (envelope: ObservationEnvelope) => void | Promise<void>;
  beforeCursorCommit?: (cursor: ObservationDestinationCursor) => void | Promise<void>;
}

const DESTINATION_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const FAILURE_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,7}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export const DEFAULT_OBSERVATION_RETENTION_POLICY: ObservationRetentionPolicy = {
  maxEnvelopes: 10_000,
  maxBytes: 64 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
  maxGapRecords: 32,
};

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
    schemaVersion: 2,
    destinationId,
    state: 'enabled',
    acknowledged: {},
    gaps: [],
    droppedEnvelopeCount: 0,
    droppedBytes: 0,
    health: { status: 'healthy', consecutiveFailures: 0 },
    updatedAt: new Date(0).toISOString(),
  };
}

function validateCursor(
  value: unknown,
  expectedDestinationId: string,
): ObservationDestinationCursor {
  if (!value || typeof value !== 'object') throw new Error('Invalid observation cursor');
  const candidate = value as {
    schemaVersion?: number;
    destinationId?: string;
    acknowledged?: Record<string, string>;
    health?: ObservationDestinationCursor['health'];
    updatedAt?: string;
  };
  const cursor: ObservationDestinationCursor =
    candidate.schemaVersion === 1
      ? {
          schemaVersion: 2,
          destinationId: candidate.destinationId ?? '',
          state: 'enabled',
          acknowledged: candidate.acknowledged ?? {},
          gaps: [],
          droppedEnvelopeCount: 0,
          droppedBytes: 0,
          health: candidate.health ?? { status: 'healthy', consecutiveFailures: 0 },
          updatedAt: candidate.updatedAt ?? '',
        }
      : (value as ObservationDestinationCursor);
  if (
    cursor.schemaVersion !== 2 ||
    cursor.destinationId !== expectedDestinationId ||
    !['enabled', 'paused', 'removed'].includes(cursor.state) ||
    !cursor.acknowledged ||
    typeof cursor.acknowledged !== 'object' ||
    Array.isArray(cursor.acknowledged) ||
    !Array.isArray(cursor.gaps) ||
    !Number.isSafeInteger(cursor.droppedEnvelopeCount) ||
    cursor.droppedEnvelopeCount < 0 ||
    !Number.isSafeInteger(cursor.droppedBytes) ||
    cursor.droppedBytes < 0 ||
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
    if (!DIGEST.test(envelopeId) || !DIGEST.test(digest)) {
      throw new Error(`Invalid observation cursor acknowledgement: ${expectedDestinationId}`);
    }
  }
  for (const gap of cursor.gaps) validateGap(gap, expectedDestinationId);
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

function validateGap(gap: ObservationRetentionGap, destinationId: string): void {
  if (
    !gap ||
    !DIGEST.test(gap.gapId) ||
    !['retention-limit', 'destination-removed'].includes(gap.reason) ||
    !Number.isSafeInteger(gap.envelopeCount) ||
    gap.envelopeCount < 1 ||
    !Number.isSafeInteger(gap.bytes) ||
    gap.bytes < 1
  ) {
    throw new Error(`Invalid observation gap: ${destinationId}`);
  }
  assertTimestamp(gap.firstObservedAt);
  assertTimestamp(gap.lastObservedAt);
  assertTimestamp(gap.recordedAt);
  if (gap.firstObservedAt > gap.lastObservedAt) {
    throw new Error(`Invalid observation gap range: ${destinationId}`);
  }
}

function validateRetentionPolicy(policy: ObservationRetentionPolicy): ObservationRetentionPolicy {
  for (const [name, value] of [
    ['maxEnvelopes', policy.maxEnvelopes],
    ['maxBytes', policy.maxBytes],
    ['maxGapRecords', policy.maxGapRecords],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Observation retention ${name} must be a positive safe integer`);
    }
  }
  if (
    policy.maxAgeMs !== undefined &&
    (!Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 1)
  ) {
    throw new Error('Observation retention maxAgeMs must be a positive safe integer');
  }
  return { ...policy };
}

function envelopeBytes(envelope: ObservationEnvelope): number {
  return Buffer.byteLength(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}

interface RetainedObservation {
  envelopeId: string;
  digest: string;
  observedAt: string;
  bytes: number;
}

function retainedObservation(envelope: ObservationEnvelope): RetainedObservation {
  return {
    envelopeId: envelope.envelopeId,
    digest: envelope.digest,
    observedAt: envelope.observedAt,
    bytes: envelopeBytes(envelope),
  };
}

function gapId(
  reason: ObservationRetentionGap['reason'],
  envelopes: readonly RetainedObservation[],
) {
  return `sha256:${createHash('sha256')
    .update([reason, ...envelopes.map((envelope) => envelope.envelopeId).sort()].join('\0'))
    .digest('hex')}` as const;
}

function gapRecord(
  reason: ObservationRetentionGap['reason'],
  envelopes: readonly RetainedObservation[],
  recordedAt: string,
): ObservationRetentionGap {
  const ordered = [...envelopes].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt),
  );
  return {
    gapId: gapId(reason, ordered),
    reason,
    envelopeCount: ordered.length,
    bytes: ordered.reduce((total, envelope) => total + envelope.bytes, 0),
    firstObservedAt: ordered[0]!.observedAt,
    lastObservedAt: ordered.at(-1)!.observedAt,
    recordedAt: new Date(recordedAt).toISOString(),
  };
}

export class FileObservationEnvelopeStore {
  private readonly writes = new Map<string, Promise<void>>();
  private maintenance: Promise<void> = Promise.resolve();
  private retentionInventory: Map<string, RetainedObservation> | null = null;
  private readonly retention: ObservationRetentionPolicy;

  constructor(
    private readonly workspace: string,
    private readonly hooks: ObservationEnvelopeStoreHooks = {},
    retention: Partial<ObservationRetentionPolicy> = {},
  ) {
    this.retention = validateRetentionPolicy({
      ...DEFAULT_OBSERVATION_RETENTION_POLICY,
      ...retention,
    });
  }

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

  private async serializeMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.maintenance;
    let resolveCurrent: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    this.maintenance = current;
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      resolveCurrent();
      if (this.maintenance === current) this.maintenance = Promise.resolve();
    }
  }

  async save(envelope: ObservationEnvelope, retentionAt = new Date().toISOString()): Promise<void> {
    validateObservationEnvelope(envelope);
    assertTimestamp(retentionAt);
    return this.serializeMaintenance(async () => {
      const file = this.envelopeFile(envelope.envelopeId);
      await mkdir(path.dirname(file), { recursive: true });
      let created = false;
      try {
        await atomicWriteJson(file, envelope, {
          exclusive: true,
          beforeCommit: () => this.hooks.beforeEnvelopeCommit?.(envelope),
        });
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const current = await this.load(envelope.envelopeId);
        if (!current || canonicalJson(current) !== canonicalJson(envelope)) {
          throw new Error(`Conflicting observation envelope: ${envelope.envelopeId}`, {
            cause: error,
          });
        }
      }
      if (created && this.retentionInventory) {
        this.retentionInventory.set(envelope.envelopeId, retainedObservation(envelope));
      }
      await this.enforceRetentionUnsafe(retentionAt);
    });
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

  async ensureDestination(
    destinationId: string,
    updatedAt = new Date().toISOString(),
  ): Promise<ObservationDestinationCursor> {
    assertDestinationId(destinationId);
    assertTimestamp(updatedAt);
    return this.serializeCursorWrite(destinationId, async () => {
      const file = this.cursorFile(destinationId);
      const value = await optionalJson(file);
      if (value !== null) return validateCursor(value, destinationId);
      const cursor = {
        ...emptyCursor(destinationId),
        updatedAt: new Date(updatedAt).toISOString(),
      };
      await this.writeCursor(cursor);
      return cursor;
    });
  }

  async pending(destinationId: string): Promise<ObservationEnvelope[]> {
    const [cursor, envelopes] = await Promise.all([this.readCursor(destinationId), this.list()]);
    if (cursor.state !== 'enabled') return [];
    return envelopes.filter(
      (envelope) => cursor.acknowledged[envelope.envelopeId] !== envelope.digest,
    );
  }

  async inspectDestination(destinationId: string): Promise<ObservationDestinationStatus> {
    const [cursor, envelopes] = await Promise.all([this.readCursor(destinationId), this.list()]);
    const pending =
      cursor.state === 'removed'
        ? []
        : envelopes.filter(
            (envelope) => cursor.acknowledged[envelope.envelopeId] !== envelope.digest,
          );
    return {
      schemaVersion: 1,
      destinationId,
      state: cursor.state,
      deliveryGuarantee: 'at-least-once',
      health: structuredClone(cursor.health),
      backlog: {
        envelopeCount: pending.length,
        bytes: pending.reduce((total, envelope) => total + envelopeBytes(envelope), 0),
        ...(pending[0] ? { oldestObservedAt: pending[0].observedAt } : {}),
        ...(pending.at(-1) ? { newestObservedAt: pending.at(-1)!.observedAt } : {}),
      },
      incomplete: cursor.gaps.length > 0,
      gaps: structuredClone(cursor.gaps),
      droppedEnvelopeCount: cursor.droppedEnvelopeCount,
      droppedBytes: cursor.droppedBytes,
      updatedAt: cursor.updatedAt,
    };
  }

  async setDestinationState(
    destinationId: string,
    state: ObservationDestinationState,
    updatedAt = new Date().toISOString(),
  ): Promise<ObservationDestinationCursor> {
    assertDestinationId(destinationId);
    if (!['enabled', 'paused', 'removed'].includes(state)) {
      throw new Error(`Invalid observation destination state: ${state}`);
    }
    assertTimestamp(updatedAt);
    return this.serializeCursorWrite(destinationId, async () => {
      const current = await this.readCursor(destinationId);
      if (current.state === state) return current;
      const envelopes = await this.list();
      let next = structuredClone(current);
      if (state === 'removed') {
        const pending = envelopes.filter(
          (envelope) => current.acknowledged[envelope.envelopeId] !== envelope.digest,
        );
        if (pending.length > 0) {
          next = this.addGap(
            next,
            gapRecord('destination-removed', pending.map(retainedObservation), updatedAt),
          );
        }
      }
      if (state === 'enabled' && current.state === 'removed') {
        next.acknowledged = Object.fromEntries(
          envelopes.map((envelope) => [envelope.envelopeId, envelope.digest]),
        );
      }
      next.state = state;
      next.updatedAt = new Date(updatedAt).toISOString();
      await this.writeCursor(next);
      return next;
    });
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
        ...current,
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

  private addGap(
    cursor: ObservationDestinationCursor,
    gap: ObservationRetentionGap,
  ): ObservationDestinationCursor {
    if (cursor.gaps.some((candidate) => candidate.gapId === gap.gapId)) return cursor;
    return {
      ...cursor,
      gaps: [...cursor.gaps, gap].slice(-this.retention.maxGapRecords),
      droppedEnvelopeCount: cursor.droppedEnvelopeCount + gap.envelopeCount,
      droppedBytes: cursor.droppedBytes + gap.bytes,
    };
  }

  private async destinationIds(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.root('destinations'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .filter((destinationId) => DESTINATION_ID.test(destinationId) && destinationId.length <= 128)
      .sort();
  }

  private async retentionEntries(): Promise<RetainedObservation[]> {
    let files: string[];
    try {
      files = (await readdir(this.root('envelopes')))
        .filter((file) => /^[a-f0-9]{64}\.json$/u.test(file))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.retentionInventory = new Map();
        return [];
      }
      throw error;
    }
    const ids = files.map((file) => `sha256:${file.slice(0, -'.json'.length)}`);
    const inventoryMatches =
      this.retentionInventory !== null &&
      ids.length === this.retentionInventory.size &&
      ids.every((envelopeId) => this.retentionInventory!.has(envelopeId));
    if (!inventoryMatches) {
      const envelopes = await Promise.all(ids.map((envelopeId) => this.load(envelopeId)));
      this.retentionInventory = new Map(
        envelopes
          .filter((envelope): envelope is ObservationEnvelope => envelope !== null)
          .map((envelope) => [envelope.envelopeId, retainedObservation(envelope)]),
      );
    }
    const retentionInventory = this.retentionInventory;
    if (retentionInventory === null) {
      throw new Error('Retention inventory was not initialized');
    }
    return [...retentionInventory.values()].sort(
      (left, right) =>
        left.observedAt.localeCompare(right.observedAt) ||
        left.envelopeId.localeCompare(right.envelopeId),
    );
  }

  private async enforceRetentionUnsafe(retentionAt: string): Promise<void> {
    const envelopes = await this.retentionEntries();
    const cutoff =
      this.retention.maxAgeMs === undefined
        ? null
        : Date.parse(retentionAt) - this.retention.maxAgeMs;
    let remainingCount = envelopes.length;
    let remainingBytes = envelopes.reduce((total, envelope) => total + envelope.bytes, 0);
    const expired = new Set(
      cutoff === null
        ? []
        : envelopes
            .filter((envelope) => Date.parse(envelope.observedAt) < cutoff)
            .map((envelope) => envelope.envelopeId),
    );
    const removed: RetainedObservation[] = [];
    for (const envelope of envelopes) {
      if (
        !expired.has(envelope.envelopeId) &&
        remainingCount <= this.retention.maxEnvelopes &&
        remainingBytes <= this.retention.maxBytes
      ) {
        continue;
      }
      removed.push(envelope);
      remainingCount -= 1;
      remainingBytes -= envelope.bytes;
    }
    if (removed.length === 0) return;

    const removedIds = new Set(removed.map((envelope) => envelope.envelopeId));
    for (const destinationId of await this.destinationIds()) {
      await this.serializeCursorWrite(destinationId, async () => {
        const cursor = await this.readCursor(destinationId);
        const missed =
          cursor.state === 'removed'
            ? []
            : removed.filter(
                (envelope) => cursor.acknowledged[envelope.envelopeId] !== envelope.digest,
              );
        const next =
          missed.length > 0
            ? this.addGap(cursor, gapRecord('retention-limit', missed, retentionAt))
            : structuredClone(cursor);
        next.acknowledged = Object.fromEntries(
          Object.entries(next.acknowledged).filter(([envelopeId]) => !removedIds.has(envelopeId)),
        );
        next.updatedAt = new Date(retentionAt).toISOString();
        await this.writeCursor(next);
      });
    }
    for (const envelope of removed) {
      await unlink(this.envelopeFile(envelope.envelopeId));
      this.retentionInventory?.delete(envelope.envelopeId);
    }
  }
}
