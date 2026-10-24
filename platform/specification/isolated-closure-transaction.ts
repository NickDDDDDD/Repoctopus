import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  advanceSpecificationClosureJournal,
  createSpecificationClosureJournal,
  recordSpecificationClosureExpectedManifest,
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
      'load' | 'create' | 'compareAndSet' | 'loadReceipt' | 'saveReceipt'
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
    const existing = await this.journals.load(plan.planDigest);
    if (existing) {
      if (existing.changeId !== plan.changeId || existing.plan.planDigest !== plan.planDigest) {
        throw new Error('Specification closure Journal belongs to another plan');
      }
      const priorReceipt = await this.journals.loadReceipt(plan.planDigest);
      if (existing.state === 'committed' && priorReceipt) {
        const priorCheckout = await this.checkouts.find(existing.checkoutId);
        if (!priorCheckout) throw new Error('Committed Specification closure checkout is missing');
        const current = await manifest(priorCheckout.root);
        if (canonicalJson(current) !== canonicalJson(existing.expected)) {
          throw new Error('Committed Specification closure checkout requires manual repair');
        }
        return { checkout: priorCheckout, result: priorReceipt };
      }
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
    const observed = recordSpecificationClosureExpectedManifest(applying, expected);
    await this.journals.compareAndSet(observed, applying.digest);
    this.injectFault?.('before-receipt');
    await this.journals.saveReceipt(result);
    const committed = advanceSpecificationClosureJournal(observed, 'committed', {
      expected,
      resultClosureId: result.closureId,
    });
    await this.journals.compareAndSet(committed, observed.digest);
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
