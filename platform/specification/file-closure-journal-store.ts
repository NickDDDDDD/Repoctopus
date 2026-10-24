import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertSpecificationClosureJournal,
  type SpecificationClosureJournal,
} from '../../domains/specification/closure-journal.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';

export class FileSpecificationClosureJournalStore {
  constructor(private readonly workspaceRoot: string) {}

  private file(planDigest: `sha256:${string}`): string {
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'specification',
      'closure-journals',
      `${planDigest.slice('sha256:'.length)}.json`,
    );
  }

  async load(planDigest: `sha256:${string}`): Promise<SpecificationClosureJournal | null> {
    try {
      const journal = JSON.parse(
        await readFile(this.file(planDigest), 'utf8'),
      ) as SpecificationClosureJournal;
      assertSpecificationClosureJournal(journal);
      return journal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async create(journal: SpecificationClosureJournal): Promise<void> {
    assertSpecificationClosureJournal(journal);
    const existing = await this.load(journal.plan.planDigest);
    if (existing) {
      if (existing.digest === journal.digest) return;
      throw new Error('Specification Closure Journal already exists with another identity');
    }
    await atomicWriteJson(this.file(journal.plan.planDigest), journal, {
      containedRoot: this.workspaceRoot,
    });
  }

  async compareAndSet(
    journal: SpecificationClosureJournal,
    expectedDigest: `sha256:${string}`,
  ): Promise<void> {
    assertSpecificationClosureJournal(journal);
    const existing = await this.load(journal.plan.planDigest);
    if (!existing || existing.digest !== expectedDigest) {
      throw new Error('Specification Closure Journal changed concurrently');
    }
    await atomicWriteJson(this.file(journal.plan.planDigest), journal, {
      containedRoot: this.workspaceRoot,
    });
  }
}
