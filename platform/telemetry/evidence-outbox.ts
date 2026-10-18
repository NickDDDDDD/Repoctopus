import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvidenceTelemetryBatch } from '../../domains/evidence/telemetry.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export interface EvidenceTelemetryCursor {
  schemaVersion: 1;
  attemptId: string;
  offset: number;
  updatedAt: string;
}

async function optionalJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class FileEvidenceTelemetryOutbox {
  constructor(private readonly workspace: string) {}

  private root(attemptId: string): string {
    return path.join(this.workspace, '.repoctopus', 'evidence', 'telemetry', attemptId);
  }

  async save(batch: EvidenceTelemetryBatch): Promise<void> {
    await atomicWriteJson(path.join(this.root(batch.attemptId), 'events.json'), batch);
  }

  async load(attemptId: string): Promise<EvidenceTelemetryBatch | null> {
    const value = await optionalJson(path.join(this.root(attemptId), 'events.json'));
    if (value === null) return null;
    const batch = value as EvidenceTelemetryBatch;
    if (
      batch.schemaVersion !== 1 ||
      batch.attemptId !== attemptId ||
      !Array.isArray(batch.events) ||
      batch.events.some((event, index) => event.sequence !== index + 1)
    ) {
      throw new Error(`Invalid Evidence telemetry outbox: ${attemptId}`);
    }
    return batch;
  }

  async readCursor(attemptId: string): Promise<EvidenceTelemetryCursor> {
    const value = await optionalJson(path.join(this.root(attemptId), 'cursor.json'));
    if (value === null) {
      return {
        schemaVersion: 1,
        attemptId,
        offset: 0,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const cursor = value as EvidenceTelemetryCursor;
    if (
      cursor.schemaVersion !== 1 ||
      cursor.attemptId !== attemptId ||
      !Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 0
    ) {
      throw new Error(`Invalid Evidence telemetry cursor: ${attemptId}`);
    }
    return cursor;
  }

  async writeCursor(cursor: EvidenceTelemetryCursor): Promise<void> {
    await atomicWriteJson(path.join(this.root(cursor.attemptId), 'cursor.json'), cursor);
  }
}
