import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  advanceSpecificationClosureJournal,
  createSpecificationClosureJournal,
  recordSpecificationClosureExpectedManifest,
  type SpecificationClosureJournal,
  type SpecificationFileIdentity,
} from '../../domains/specification/closure-journal.js';
import { decideSpecificationClosureRecovery } from '../../domains/specification/closure-candidate.js';
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

type UnboundSpecificationClosureResult = Omit<SpecificationClosureResult, 'candidate'>;

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

function changedFiles(
  before: readonly SpecificationFileIdentity[],
  after: readonly SpecificationFileIdentity[],
): string[] {
  const previous = new Map(before.map((file) => [file.path, file.contentDigest]));
  const current = new Map(after.map((file) => [file.path, file.contentDigest]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((file) => previous.get(file) !== current.get(file))
    .sort();
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
    ) => Promise<UnboundSpecificationClosureResult>,
    private readonly injectFault?: (point: SpecificationClosureFaultPoint) => void,
    private readonly recoverOfficialArchive?: (
      checkoutRoot: string,
      plan: SpecificationClosurePlan,
      before: readonly SpecificationFileIdentity[],
      changedFiles: readonly string[],
      signal?: AbortSignal,
    ) => Promise<UnboundSpecificationClosureResult>,
  ) {}

  private bindCandidate(
    checkout: IsolatedSpecificationCheckout,
    result: UnboundSpecificationClosureResult,
  ): SpecificationClosureResult {
    return {
      ...result,
      candidate: {
        checkoutId: checkout.checkoutId,
        baseOid: checkout.head,
      },
    };
  }

  async execute(
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<IsolatedClosureExecution> {
    const existing = await this.journals.load(plan.planDigest);
    if (existing) {
      if (existing.changeId !== plan.changeId || existing.plan.planDigest !== plan.planDigest) {
        throw new Error('Specification closure Journal belongs to another plan');
      }
      return this.recover(existing, signal);
    }
    const checkout = await this.checkouts.create(checkoutId(plan), plan.sourceOid);
    const prepared = createSpecificationClosureJournal({
      changeId: plan.changeId,
      checkoutId: checkout.checkoutId,
      plan,
      before: await manifest(checkout.root),
      expectedArchiveId: `${plan.changeId}:${plan.planDigest.slice(7, 19)}`,
    });
    await this.journals.create(prepared);
    this.injectFault?.('after-prepared');

    return this.apply(prepared, checkout, signal);
  }

  private async recover(
    journal: SpecificationClosureJournal,
    signal?: AbortSignal,
  ): Promise<IsolatedClosureExecution> {
    const checkout = await this.checkouts.find(journal.checkoutId);
    if (!checkout) throw new Error('Specification closure checkout is missing and requires repair');
    const current = await manifest(checkout.root);
    const priorReceipt = await this.journals.loadReceipt(journal.plan.planDigest);

    if (journal.state === 'committed') {
      const decision = decideSpecificationClosureRecovery({
        journal,
        current,
        candidateValid: priorReceipt !== null,
      });
      if (decision !== 'return-committed' || !priorReceipt) {
        throw new Error('Committed Specification closure checkout requires manual repair');
      }
      return { checkout, result: priorReceipt };
    }

    const initialDecision = decideSpecificationClosureRecovery({
      journal,
      current,
      candidateValid: false,
    });
    if (initialDecision === 'continue-apply') return this.apply(journal, checkout, signal);
    if (journal.state !== 'applying' || !this.recoverOfficialArchive) {
      throw new Error('Specification closure Journal requires manual repair');
    }

    const recovered = this.bindCandidate(
      checkout,
      await this.recoverOfficialArchive(
        checkout.root,
        journal.plan,
        journal.before,
        changedFiles(journal.before, current),
        signal,
      ),
    );
    if (priorReceipt && canonicalJson(priorReceipt) !== canonicalJson(recovered)) {
      throw new Error('Specification closure Receipt conflicts with the recovered candidate');
    }
    const observed =
      journal.expected.length === 0
        ? recordSpecificationClosureExpectedManifest(journal, current)
        : journal;
    if (observed !== journal) await this.journals.compareAndSet(observed, journal.digest);
    const decision = decideSpecificationClosureRecovery({
      journal: observed,
      current,
      candidateValid: true,
    });
    if (decision !== 'continue-commit') {
      throw new Error('Specification closure candidate requires manual repair');
    }
    await this.journals.saveReceipt(recovered);
    const committed = advanceSpecificationClosureJournal(observed, 'committed', {
      expected: current,
      resultClosureId: recovered.closureId,
    });
    await this.journals.compareAndSet(committed, observed.digest);
    return { checkout, result: recovered };
  }

  private async apply(
    journal: SpecificationClosureJournal,
    checkout: IsolatedSpecificationCheckout,
    signal?: AbortSignal,
  ): Promise<IsolatedClosureExecution> {
    const applying =
      journal.state === 'prepared'
        ? advanceSpecificationClosureJournal(journal, 'applying')
        : journal;
    if (applying !== journal) await this.journals.compareAndSet(applying, journal.digest);
    if (applying.state !== 'applying' || applying.expected.length > 0) {
      throw new Error('Specification closure Journal cannot execute the archive command');
    }

    this.injectFault?.('after-applying');
    const result = this.bindCandidate(
      checkout,
      await this.executeOfficialArchive(checkout.root, applying.plan, signal),
    );
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
