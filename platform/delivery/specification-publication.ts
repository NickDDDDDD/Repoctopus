import type { PublicationReceiptItem } from '../../domains/delivery/publication-receipt.js';
import {
  createSpecificationPublicationJournal,
  recordSpecificationPublicationCommit,
  recordSpecificationPublicationCompletion,
  recordSpecificationPublicationPush,
  type SpecificationPublicationJournal,
  type SpecificationPublicationJournalStore,
} from '../../domains/delivery/specification-publication-journal.js';
import type { MergeRequestInput, MergeRequestPort } from '../../domains/delivery/ports.js';
import { observeOrCreateMergeRequest } from '../../domains/delivery/stable-publication.js';
import type {
  SpecificationPublicationRequest,
  SpecificationPublicationResult,
} from '../../domains/delivery/specification-publication.js';
import type { MergeRequestStatus } from '../../domains/delivery/types.js';
import { GitSpecificationCheckoutManager } from '../git/specification-checkout.js';
import { execute } from '../process/execute.js';
import { FileSpecificationPublicationJournalStore } from './file-specification-publication-journal-store.js';

export type SpecificationPublicationFaultPoint = 'after-commit' | 'after-push' | 'after-mr';

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

function nulPaths(output: string): string[] {
  return output
    .split('\0')
    .filter(Boolean)
    .map((value) => value.replaceAll('\\', '/'))
    .sort();
}

function samePaths(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function changedPaths(cwd: string): Promise<string[]> {
  const [unstaged, staged, untracked] = await Promise.all([
    execute('git', ['diff', '--name-only', '--no-renames', '-z'], { cwd }).then((value) =>
      nulPaths(value.stdout),
    ),
    execute('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd }).then(
      (value) => nulPaths(value.stdout),
    ),
    execute('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd }).then((value) =>
      nulPaths(value.stdout),
    ),
  ]);
  return [...new Set([...unstaged, ...staged, ...untracked])].sort();
}

async function remoteOid(cwd: string, remote: string, branch: string): Promise<string | null> {
  const output = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  return output.split(/\s+/u)[0] || null;
}

function mergeRequestInput(request: SpecificationPublicationRequest): MergeRequestInput {
  return {
    repositoryId: request.changeBranch.repositoryId,
    remoteIdentity: request.changeBranch.remoteIdentity,
    sourceBranch: `repoctopus/archive/${request.changeId}-${request.closure.closureId.slice(7, 19)}`,
    targetBranch: request.changeBranch.targetBranch,
    title: request.title,
    body: request.body,
  };
}

function exactStatus(
  status: MergeRequestStatus,
  request: MergeRequestInput,
  publishedOid: string,
): boolean {
  return (
    status.repositoryId === request.repositoryId &&
    status.sourceBranch === request.sourceBranch &&
    status.targetBranch === request.targetBranch &&
    status.headCommit === publishedOid
  );
}

export class SpecificationPublicationAdapter {
  constructor(
    private readonly mergeRequests: MergeRequestPort,
    private readonly injectFault?: (point: SpecificationPublicationFaultPoint) => void,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async exactMergeRequests(
    request: MergeRequestInput,
    publishedOid: string,
  ): Promise<MergeRequestStatus[]> {
    const identities = this.mergeRequests.findAll
      ? await this.mergeRequests.findAll(request)
      : await (async () => {
          const identity = await this.mergeRequests.find(request);
          return identity ? [identity] : [];
        })();
    const statuses = await Promise.all(
      identities.map((identity) => this.mergeRequests.status(identity)),
    );
    const exact = statuses.filter((status) => exactStatus(status, request, publishedOid));
    if (statuses.length > 0 && exact.length === 0) {
      throw new Error('Specification merge request candidates do not match the published OID');
    }
    if (exact.length > 1) throw new Error('Specification merge request publication is ambiguous');
    return exact;
  }

  private async verifyCompleted(
    journal: SpecificationPublicationJournal,
    request: SpecificationPublicationRequest,
  ): Promise<PublicationReceiptItem> {
    const result = journal.result;
    if (!result || !journal.publishedOid) {
      throw new Error('Completed Specification publication Journal is incomplete');
    }
    const observedRemote = await remoteOid(
      request.workspaceRoot,
      journal.intent.remote,
      journal.intent.sourceBranch,
    );
    if (observedRemote !== journal.publishedOid) {
      throw new Error('Completed Specification publication remote OID drifted');
    }
    const exact = await this.exactMergeRequests(mergeRequestInput(request), journal.publishedOid);
    if (
      exact.length !== 1 ||
      exact[0]!.provider !== result.mergeRequest.provider ||
      exact[0]!.repositoryId !== result.mergeRequest.repositoryId ||
      exact[0]!.number !== result.mergeRequest.number
    ) {
      throw new Error('Completed Specification publication merge request drifted');
    }
    return structuredClone(result);
  }

  private async adoptOrCommit(
    journal: SpecificationPublicationJournal,
    checkoutRoot: string,
  ): Promise<string> {
    const { intent } = journal;
    const head = await git(checkoutRoot, ['rev-parse', 'HEAD']);
    if (head === intent.baseOid) {
      const changed = await changedPaths(checkoutRoot);
      if (!samePaths(changed, intent.changedFiles)) {
        throw new Error('Specification candidate diff escaped the Closure Receipt allowlist');
      }
      await git(checkoutRoot, ['add', '--all', '--', ...intent.changedFiles]);
      const staged = nulPaths(
        (
          await execute('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], {
            cwd: checkoutRoot,
          })
        ).stdout,
      );
      if (!samePaths(staged, intent.changedFiles)) {
        throw new Error(
          'Specification candidate staged diff escaped the Closure Receipt allowlist',
        );
      }
      await git(checkoutRoot, ['commit', '-m', intent.commitMessage]);
      const committed = await git(checkoutRoot, ['rev-parse', 'HEAD']);
      this.injectFault?.('after-commit');
      return committed;
    }

    const [parent, count, message, committedPaths] = await Promise.all([
      git(checkoutRoot, ['rev-parse', 'HEAD^']),
      git(checkoutRoot, ['rev-list', '--count', `${intent.baseOid}..HEAD`]),
      git(checkoutRoot, ['log', '-1', '--format=%s']),
      execute('git', ['diff', '--name-only', '--no-renames', '-z', intent.baseOid, 'HEAD'], {
        cwd: checkoutRoot,
      }).then((value) => nulPaths(value.stdout)),
    ]);
    if (
      parent !== intent.baseOid ||
      count !== '1' ||
      message !== intent.commitMessage ||
      !samePaths(committedPaths, intent.changedFiles) ||
      (await changedPaths(checkoutRoot)).length > 0
    ) {
      throw new Error('Specification candidate commit cannot be safely adopted');
    }
    return head;
  }

  async publish(request: SpecificationPublicationRequest): Promise<SpecificationPublicationResult> {
    if (
      request.closure.changeId !== request.changeId ||
      request.closure.status !== 'closed' ||
      request.closure.candidate.baseOid !== request.changeBranch.remoteOid
    ) {
      throw new Error('Specification publication requires the matching isolated Closure Receipt');
    }
    const sourceBranch = `repoctopus/archive/${request.changeId}-${request.closure.closureId.slice(7, 19)}`;
    await git(request.workspaceRoot, ['check-ref-format', '--branch', sourceBranch]);
    const stores: SpecificationPublicationJournalStore =
      new FileSpecificationPublicationJournalStore(request.workspaceRoot);
    let journal = await stores.load(request.runId);
    if (!journal) {
      journal = createSpecificationPublicationJournal({
        changeId: request.changeId,
        runId: request.runId,
        closureId: request.closure.closureId,
        planDigest: request.closure.planDigest,
        checkoutId: request.closure.candidate.checkoutId,
        baseOid: request.closure.candidate.baseOid,
        changedFiles: request.closure.changedFiles,
        repositoryId: request.changeBranch.repositoryId,
        remoteIdentity: request.changeBranch.remoteIdentity,
        remote: request.remote,
        sourceBranch,
        targetBranch: request.changeBranch.targetBranch,
        commitMessage: `chore(spec): archive ${request.changeId}`,
      });
      await stores.create(journal);
    } else {
      const expected = createSpecificationPublicationJournal({
        ...journal.intent,
        closureId: request.closure.closureId,
        planDigest: request.closure.planDigest,
        checkoutId: request.closure.candidate.checkoutId,
        baseOid: request.closure.candidate.baseOid,
        changedFiles: request.closure.changedFiles,
        repositoryId: request.changeBranch.repositoryId,
        remoteIdentity: request.changeBranch.remoteIdentity,
        remote: request.remote,
        sourceBranch,
        targetBranch: request.changeBranch.targetBranch,
      });
      if (expected.journalId !== journal.journalId) {
        throw new Error('Specification publication request drifted from its Journal');
      }
    }

    const checkouts = new GitSpecificationCheckoutManager(request.workspaceRoot);
    if (journal.state === 'completed') {
      const item = await this.verifyCompleted(journal, request);
      const checkout = await checkouts.find(journal.intent.checkoutId);
      if (checkout) await checkouts.cleanup(checkout);
      return { expectedPublishedOid: item.publishedOid, item };
    }

    const checkout = await checkouts.find(journal.intent.checkoutId);
    if (!checkout) throw new Error('Specification publication candidate checkout is missing');
    const currentHead = await git(checkout.root, ['rev-parse', 'HEAD']);
    if (journal.state !== 'prepared' && journal.publishedOid !== currentHead) {
      throw new Error('Specification publication candidate checkout drifted');
    }

    if (journal.state === 'prepared') {
      const committedOid = await this.adoptOrCommit(journal, checkout.root);
      const committed = recordSpecificationPublicationCommit(journal, committedOid);
      await stores.compareAndSet(committed, journal.digest);
      journal = committed;
    }

    if (journal.state === 'committed') {
      const observed = await remoteOid(checkout.root, journal.intent.remote, sourceBranch);
      if (observed && observed !== journal.publishedOid) {
        throw new Error('Specification publication remote branch drifted');
      }
      if (!observed) {
        await git(checkout.root, [
          'push',
          journal.intent.remote,
          `${journal.publishedOid}:refs/heads/${sourceBranch}`,
        ]);
        const published = await remoteOid(checkout.root, journal.intent.remote, sourceBranch);
        if (published !== journal.publishedOid) {
          throw new Error('Specification publication remote OID drifted');
        }
        this.injectFault?.('after-push');
      }
      const pushed = recordSpecificationPublicationPush(journal);
      await stores.compareAndSet(pushed, journal.digest);
      journal = pushed;
    }

    if (journal.state === 'pushed') {
      const mr = await observeOrCreateMergeRequest({
        port: this.mergeRequests,
        request: mergeRequestInput(request),
        identity: {
          changeId: request.changeId,
          runId: request.runId,
          repositoryId: request.changeBranch.repositoryId,
          remoteIdentity: request.changeBranch.remoteIdentity,
          sourceBranch,
          targetBranch: request.changeBranch.targetBranch,
          publishedOid: journal.publishedOid!,
        },
      });
      this.injectFault?.('after-mr');
      const item: PublicationReceiptItem = {
        publicationId: `specification:${request.runId}`,
        role: 'specification',
        repositoryId: request.changeBranch.repositoryId,
        remoteIdentity: request.changeBranch.remoteIdentity,
        remote: request.remote,
        sourceBranch,
        targetBranch: request.changeBranch.targetBranch,
        publishedOid: journal.publishedOid!,
        mergeRequest: mr.identity,
        provenance: mr.provenance === 'human-created' ? 'recovered' : mr.provenance,
        verifiedAt: this.clock().toISOString(),
      };
      const completed = recordSpecificationPublicationCompletion(journal, item);
      await stores.compareAndSet(completed, journal.digest);
      journal = completed;
    }

    const item = await this.verifyCompleted(journal, request);
    await checkouts.cleanup(checkout);
    return { expectedPublishedOid: item.publishedOid, item };
  }
}
