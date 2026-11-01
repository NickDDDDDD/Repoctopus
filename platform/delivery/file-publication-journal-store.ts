import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  PublicationJournal,
  PublicationJournalStore,
} from '../../domains/delivery/publication-journal.js';
import { assertPublicationJournal } from '../../domains/delivery/publication-journal.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { withRecoverableFileLock } from '../runtime/recoverable-file-lock.js';

export class FilePublicationJournalStore implements PublicationJournalStore {
  constructor(private readonly workspaceRoot: string) {}

  private file(runId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(runId)) {
      throw new Error('Publication Journal Run id is invalid');
    }
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'delivery',
      'publications',
      `${runId}.json`,
    );
  }

  async load(runId: string): Promise<PublicationJournal | null> {
    try {
      const journal = JSON.parse(
        await readFile(this.file(runId), 'utf8'),
      ) as PublicationJournal;
      assertPublicationJournal(journal);
      return journal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async create(journal: PublicationJournal): Promise<void> {
    assertPublicationJournal(journal);
    await withRecoverableFileLock(`${this.file(journal.runId)}.lock`, async () => {
      const current = await this.load(journal.runId);
      if (current) {
        if (current.digest === journal.digest) return;
        throw new Error('Publication Journal already exists with another identity');
      }
      await atomicWriteJson(this.file(journal.runId), journal, {
        containedRoot: this.workspaceRoot,
      });
    });
  }

  async compareAndSet(
    journal: PublicationJournal,
    expectedDigest: `sha256:${string}`,
  ): Promise<void> {
    assertPublicationJournal(journal);
    await withRecoverableFileLock(`${this.file(journal.runId)}.lock`, async () => {
      const current = await this.load(journal.runId);
      if (!current || current.digest !== expectedDigest) {
        throw new Error('Publication Journal changed concurrently');
      }
      await atomicWriteJson(this.file(journal.runId), journal, {
        containedRoot: this.workspaceRoot,
      });
    });
  }
}
