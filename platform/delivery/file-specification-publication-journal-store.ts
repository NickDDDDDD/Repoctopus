import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertSpecificationPublicationJournal,
  type SpecificationPublicationJournal,
  type SpecificationPublicationJournalStore,
} from '../../domains/delivery/specification-publication-journal.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export class FileSpecificationPublicationJournalStore implements SpecificationPublicationJournalStore {
  constructor(private readonly workspaceRoot: string) {}

  private file(changeId: string, generation: number): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(changeId)) {
      throw new Error('Specification publication Journal Change id is invalid');
    }
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('Specification publication Journal generation is invalid');
    }
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'delivery',
      'specification-publications',
      `${changeId}.g${generation}.json`,
    );
  }

  async load(
    changeId: string,
    generation: number,
  ): Promise<SpecificationPublicationJournal | null> {
    try {
      const journal = JSON.parse(
        await readFile(this.file(changeId, generation), 'utf8'),
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
    const existing = await this.load(journal.intent.changeId, journal.intent.generation);
    if (existing) {
      if (existing.digest === journal.digest) return;
      throw new Error('Specification publication Journal already exists with another identity');
    }
    await atomicWriteJson(this.file(journal.intent.changeId, journal.intent.generation), journal, {
      containedRoot: this.workspaceRoot,
    });
  }

  async compareAndSet(
    journal: SpecificationPublicationJournal,
    expectedDigest: `sha256:${string}`,
  ): Promise<void> {
    assertSpecificationPublicationJournal(journal);
    const existing = await this.load(journal.intent.changeId, journal.intent.generation);
    if (!existing || existing.digest !== expectedDigest) {
      throw new Error('Specification publication Journal changed concurrently');
    }
    await atomicWriteJson(this.file(journal.intent.changeId, journal.intent.generation), journal, {
      containedRoot: this.workspaceRoot,
    });
  }
}
