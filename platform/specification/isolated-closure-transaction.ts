import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  advanceSpecificationClosureJournal,
  createSpecificationClosureJournal,
  type SpecificationFileIdentity,
} from '../../domains/specification/closure-journal.js';
import type {
  SpecificationClosurePlan,
  SpecificationClosureResult,
} from '../../domains/specification/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import type {
  GitSpecificationCheckoutManager,
  IsolatedSpecificationCheckout,
} from '../git/specification-checkout.js';
import type { FileSpecificationClosureJournalStore } from './file-closure-journal-store.js';

export type SpecificationClosureFaultPoint =
  | 'after-prepared'
  | 'after-applying'
  | 'after-command'
  | 'before-receipt';

export interface IsolatedClosureExecution {
  checkout: IsolatedSpecificationCheckout;
  result: SpecificationClosureResult;
}

async function files(root: string, relative = ''): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  const result: string[] = [];
  for (const entry of entries) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) result.push(...(await files(root, child)));
    else if (entry.isFile()) result.push(child);
  }
  return result.sort();
}

async function manifest(root: string): Promise<SpecificationFileIdentity[]> {
  const openspec = path.join(root, 'openspec');
  return Promise.all(
    (await files(openspec)).map(async (relative) => {
      const file = path.join(openspec, relative);
      if (!(await stat(file)).isFile())
        throw new Error(`Specification path is not a file: ${relative}`);
      const content = await readFile(file);
      return {
        path: `openspec/${relative}`,
        kind: 'file' as const,
        contentDigest: `sha256:${createHash('sha256').update(content).digest('hex')}` as const,
      };
    }),
  );
}

function checkoutId(plan: SpecificationClosurePlan): string {
  return `closure-${plan.planDigest.slice('sha256:'.length, 23)}`;
}

/** Local transaction boundary around the official OpenSpec archive command. */
export class IsolatedSpecificationClosureTransaction {
  constructor(
    private readonly journals: Pick<
      FileSpecificationClosureJournalStore,
      'load' | 'create' | 'compareAndSet'
    >,
    private readonly checkouts: Pick<
      GitSpecificationCheckoutManager,
      'create' | 'find' | 'cleanup'
    >,
    private readonly executeOfficialArchive: (
      checkoutRoot: string,
      plan: SpecificationClosurePlan,
      signal?: AbortSignal,
    ) => Promise<SpecificationClosureResult>,
    private readonly injectFault?: (point: SpecificationClosureFaultPoint) => void,
  ) {}

  async execute(
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<IsolatedClosureExecution> {
    if (await this.journals.load(plan.planDigest)) {
      throw new Error('Specification closure already has a Journal and requires recovery');
    }
    const checkout = await this.checkouts.create(checkoutId(plan));
    const prepared = createSpecificationClosureJournal({
      changeId: plan.changeId,
      checkoutId: checkout.checkoutId,
      plan,
      before: await manifest(checkout.root),
      expectedArchiveId: `${plan.changeId}:${plan.planDigest.slice(7, 19)}`,
    });
    await this.journals.create(prepared);
    this.injectFault?.('after-prepared');

    const applying = advanceSpecificationClosureJournal(prepared, 'applying');
    await this.journals.compareAndSet(applying, prepared.digest);
    this.injectFault?.('after-applying');
    const result = await this.executeOfficialArchive(checkout.root, plan, signal);
    this.injectFault?.('after-command');

    const expected = await manifest(checkout.root);
    this.injectFault?.('before-receipt');
    const committed = advanceSpecificationClosureJournal(applying, 'committed', {
      expected,
      resultClosureId: result.closureId,
    });
    await this.journals.compareAndSet(committed, applying.digest);
    return { checkout, result };
  }

  identity(input: IsolatedClosureExecution): string {
    return canonicalJson({
      checkoutId: input.checkout.checkoutId,
      closureId: input.result.closureId,
      planDigest: input.result.planDigest,
    });
  }
}
