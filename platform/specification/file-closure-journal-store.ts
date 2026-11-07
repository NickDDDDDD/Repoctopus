import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  assertSpecificationClosureJournal,
  type SpecificationClosureJournal,
} from '../../domains/specification/closure-journal.js';
import type {
  SpecificationClosureResult,
  SpecificationClosurePlan,
} from '../../domains/specification/types.js';
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

  private receiptFile(planDigest: `sha256:${string}`): string {
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'specification',
      'closures',
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

  async hasExecution(changeId: string): Promise<boolean> {
    return (await this.planForChange(changeId)) !== null;
  }

  async planForChange(changeId: string): Promise<SpecificationClosurePlan | null> {
    const directory = path.dirname(this.file(`sha256:${'0'.repeat(64)}`));
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    if (entries.length > 4096)
      throw new Error('Specification closure journal inventory exceeds its bound');
    const plans: SpecificationClosurePlan[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json'))
        throw new Error('Specification closure journal inventory is invalid');
      const journal = JSON.parse(
        await readFile(path.join(directory, entry.name), 'utf8'),
      ) as SpecificationClosureJournal;
      assertSpecificationClosureJournal(journal);
      if (journal.changeId === changeId && journal.state !== 'rolled-back')
        plans.push(journal.plan);
    }
    if (plans.length > 1)
      throw new Error('Specification Change has multiple unresolved closure plans');
    return plans[0] ?? null;
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

  async loadReceipt(planDigest: `sha256:${string}`): Promise<SpecificationClosureResult | null> {
    try {
      return JSON.parse(
        await readFile(this.receiptFile(planDigest), 'utf8'),
      ) as SpecificationClosureResult;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveReceipt(result: SpecificationClosureResult): Promise<void> {
    await atomicWriteJson(this.receiptFile(result.planDigest), result, {
      containedRoot: this.workspaceRoot,
    });
  }
}
