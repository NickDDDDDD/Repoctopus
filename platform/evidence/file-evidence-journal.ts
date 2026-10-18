import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvidenceJournal, EvidenceJournalEntry } from '../../domains/evidence/ports.js';
import { FileResourceLeaseManager } from '../runtime/resource-lease.js';

export class FileEvidenceJournal implements EvidenceJournal {
  private readonly leases: FileResourceLeaseManager;
  private readonly appendQueues = new Map<string, Promise<void>>();

  constructor(private readonly workspace: string) {
    this.leases = new FileResourceLeaseManager(workspace);
  }

  private file(attemptId: string): string {
    return path.join(
      this.workspace,
      '.repoctopus',
      'runtime',
      'attempts',
      attemptId,
      'journal.jsonl',
    );
  }

  async load(attemptId: string): Promise<EvidenceJournalEntry[]> {
    try {
      const source = await readFile(this.file(attemptId), 'utf8');
      if (source !== '' && !source.endsWith('\n')) {
        throw new Error(`Evidence journal is truncated: ${attemptId}`);
      }
      return source
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          const entry = JSON.parse(line) as EvidenceJournalEntry;
          if (
            entry.schemaVersion !== 1 ||
            entry.attemptId !== attemptId ||
            entry.sequence !== index + 1 ||
            !['node.intent', 'node.completed'].includes(entry.type)
          ) {
            throw new Error(`Invalid evidence journal entry ${index + 1}: ${attemptId}`);
          }
          return entry;
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async append(
    attemptId: string,
    nodeId: string,
    timestamp: string,
    type: EvidenceJournalEntry['type'],
    receiptId?: string,
  ): Promise<void> {
    const previous = this.appendQueues.get(attemptId) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(() =>
      this.leases.withLease(`evidence-journal:${attemptId}`, async () => {
        const entries = await this.load(attemptId);
        const entry: EvidenceJournalEntry = {
          schemaVersion: 1,
          sequence: entries.length + 1,
          eventId: randomUUID(),
          attemptId,
          nodeId,
          timestamp,
          type,
          ...(receiptId ? { receiptId } : {}),
        };
        const file = this.file(attemptId);
        await mkdir(path.dirname(file), { recursive: true });
        const handle = await open(file, 'a', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(entry)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
      }),
    );
    this.appendQueues.set(attemptId, queued);
    try {
      await queued;
    } finally {
      if (this.appendQueues.get(attemptId) === queued) this.appendQueues.delete(attemptId);
    }
  }

  async recordIntent(attemptId: string, nodeId: string, timestamp: string): Promise<void> {
    await this.append(attemptId, nodeId, timestamp, 'node.intent');
  }

  async recordCompletion(
    attemptId: string,
    nodeId: string,
    receiptId: string,
    timestamp: string,
  ): Promise<void> {
    await this.append(attemptId, nodeId, timestamp, 'node.completed', receiptId);
  }
}
