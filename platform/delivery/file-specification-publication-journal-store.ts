import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertSpecificationPublicationJournal,
  type SpecificationPublicationJournal,
  type SpecificationPublicationJournalStore,
} from '../../domains/delivery/specification-publication-journal.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { withRecoverableFileLock } from '../runtime/recoverable-file-lock.js';

export class FileSpecificationPublicationJournalStore implements SpecificationPublicationJournalStore {
  constructor(private readonly workspaceRoot: string) {}

  private file(runId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(runId)) {
      throw new Error('Specification publication Journal Run id is invalid');
    }
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'delivery',
      'specification-publications',
      `${runId}.json`,
    );
  }

  async load(runId: string): Promise<SpecificationPublicationJournal | null> {
    try {
      const journal = JSON.parse(
        await readFile(this.file(runId), 'utf8'),
      ) as SpecificationPublicationJournal;
      assertSpecificationPublicationJournal(journal);
      return journal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async create(journal: SpecificationPublicationJournal): Promise<void> {
    assertSpecificationPublicationJournal(journal);
    await withRecoverableFileLock(`${this.file(journal.intent.runId)}.lock`, async () => {
      const existing = await this.load(journal.intent.runId);
      if (existing) {
        if (existing.digest === journal.digest) return;
        throw new Error('Specification publication Journal already exists with another identity');
      }
      await atomicWriteJson(this.file(journal.intent.runId), journal, {
        containedRoot: this.workspaceRoot,
      });
    });
  }

  async compareAndSet(
    journal: SpecificationPublicationJournal,
    expectedDigest: `sha256:${string}`,
  ): Promise<void> {
    assertSpecificationPublicationJournal(journal);
    await withRecoverableFileLock(`${this.file(journal.intent.runId)}.lock`, async () => {
      const existing = await this.load(journal.intent.runId);
      if (!existing || existing.digest !== expectedDigest) {
        throw new Error('Specification publication Journal changed concurrently');
      }
      await atomicWriteJson(this.file(journal.intent.runId), journal, {
        containedRoot: this.workspaceRoot,
      });
    });
  }
}
