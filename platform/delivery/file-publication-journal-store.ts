import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  PublicationJournal,
  PublicationJournalStore,
} from '../../domains/delivery/publication-journal.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export class FilePublicationJournalStore implements PublicationJournalStore {
  constructor(private readonly workspaceRoot: string) {}

  private file(changeId: string, generation: number): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(changeId)) {
      throw new Error('Publication Journal Change id is invalid');
    }
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'delivery',
      'publications',
      `${changeId}.g${generation}.json`,
    );
  }

  async load(changeId: string, generation: number): Promise<PublicationJournal | null> {
    try {
      return JSON.parse(
        await readFile(this.file(changeId, generation), 'utf8'),
      ) as PublicationJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async create(journal: PublicationJournal): Promise<void> {
    const current = await this.load(journal.changeId, journal.generation);
    if (current) {
      if (current.digest === journal.digest) return;
      throw new Error('Publication Journal already exists with another identity');
    }
    await atomicWriteJson(this.file(journal.changeId, journal.generation), journal, {
      containedRoot: this.workspaceRoot,
    });
  }

  async compareAndSet(
    journal: PublicationJournal,
    expectedDigest: `sha256:${string}`,
  ): Promise<void> {
    const current = await this.load(journal.changeId, journal.generation);
    if (!current || current.digest !== expectedDigest) {
      throw new Error('Publication Journal changed concurrently');
    }
    await atomicWriteJson(this.file(journal.changeId, journal.generation), journal, {
      containedRoot: this.workspaceRoot,
    });
  }
}
