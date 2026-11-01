import { describe, expect, it, vi } from 'vitest';

import {
  ResumablePublicationExecutor,
  createPublicationJournal,
  type PublicationItemExecutor,
  type PublicationJournal,
  type PublicationJournalItemIntent,
  type PublicationJournalStore,
} from '../domains/delivery/publication-journal.js';
import { PublicationResultUnknownError } from '../domains/delivery/publication-result-unknown.js';
import type { PublicationReceiptItem } from '../domains/delivery/publication-receipt.js';

class MemoryStore implements PublicationJournalStore {
  journal: PublicationJournal | null = null;
  load(): Promise<PublicationJournal | null> {
    return Promise.resolve(this.journal ? structuredClone(this.journal) : null);
  }
  create(journal: PublicationJournal): Promise<void> {
    this.journal = structuredClone(journal);
    return Promise.resolve();
  }
  compareAndSet(journal: PublicationJournal, expectedDigest: `sha256:${string}`): Promise<void> {
    if (this.journal?.digest !== expectedDigest) throw new Error('CAS conflict');
    this.journal = structuredClone(journal);
    return Promise.resolve();
  }
}

function intent(
  id: string,
  repositoryId: string,
  role: 'business' | 'specification',
): PublicationJournalItemIntent {
  return {
    publicationId: id,
    role,
    ...(role === 'business' ? { deliveryId: id } : {}),
    repositoryId,
    remoteIdentity: `team/${repositoryId}`,
    remote: 'origin',
    sourceBranch: `feature/${id}`,
    targetBranch: 'main',
    mergeRequestTitle: `Publish ${id}`,
    mergeRequestBody: `Verified ${id}`,
    expectedOid: (repositoryId === 'workspace' ? 'c' : id.charAt(0)).repeat(40),
    operation: 'push-and-create-or-adopt-mr',
  };
}

function result(value: PublicationJournalItemIntent): PublicationReceiptItem {
  return {
    publicationId: value.publicationId,
    role: value.role,
    ...(value.deliveryId ? { deliveryId: value.deliveryId } : {}),
    repositoryId: value.repositoryId,
    remoteIdentity: value.remoteIdentity,
    remote: value.remote,
    sourceBranch: value.sourceBranch,
    targetBranch: value.targetBranch,
    publishedOid: value.expectedOid,
    mergeRequest: {
      provider: 'github',
      repositoryId: value.repositoryId,
      number: value.publicationId.length,
      url: `https://github.com/${value.remoteIdentity}/pull/${value.publicationId.length}`,
    },
    provenance: 'runtime-created',
    verifiedAt: '2026-10-24T00:00:00.000Z',
  };
}

function adapter(input: {
  remoteOids: Map<string, string>;
  mergeRequests: Map<string, PublicationReceiptItem>;
  push?: PublicationItemExecutor['push'];
  createMergeRequest?: PublicationItemExecutor['createMergeRequest'];
}): PublicationItemExecutor {
  return {
    observePush: (candidate) =>
      Promise.resolve(input.remoteOids.get(candidate.publicationId) ?? null),
    push:
      input.push ??
      ((candidate) => {
        input.remoteOids.set(candidate.publicationId, candidate.expectedOid);
        return Promise.resolve(candidate.expectedOid);
      }),
    observeMergeRequest: (candidate) =>
      Promise.resolve(input.mergeRequests.get(candidate.publicationId) ?? null),
    createMergeRequest:
      input.createMergeRequest ??
      ((candidate) => {
        const receipt = result(candidate);
        input.mergeRequests.set(candidate.publicationId, receipt);
        return Promise.resolve(receipt);
      }),
  };
}

describe('resumable multi-repository publication', () => {
  it('continues by observation without repeating an uncertain push', async () => {
    const items = [
      intent('app', 'app', 'business'),
      intent('backend', 'backend', 'business'),
      intent('specification', 'workspace', 'specification'),
    ];
    const store = new MemoryStore();
    const remoteOids = new Map<string, string>();
    const mergeRequests = new Map<string, PublicationReceiptItem>();
    const firstPush = vi.fn<PublicationItemExecutor['push']>((candidate) => {
      if (candidate.publicationId === 'backend') {
        return Promise.reject(new Error('push response and observation unavailable'));
      }
      remoteOids.set(candidate.publicationId, candidate.expectedOid);
      return Promise.resolve(candidate.expectedOid);
    });

    await expect(
      new ResumablePublicationExecutor(
        store,
        adapter({ remoteOids, mergeRequests, push: firstPush }),
      ).publish({ changeId: 'resume', runId: 'run-resume', items }),
    ).rejects.toBeInstanceOf(PublicationResultUnknownError);
    expect(
      Object.fromEntries(
        store.journal!.items.map((item) => [item.intent.publicationId, item.status]),
      ),
    ).toEqual({ app: 'published', backend: 'push-unknown', specification: 'pending' });

    remoteOids.set('backend', items[1]!.expectedOid);
    const resumedPush = vi.fn<PublicationItemExecutor['push']>((candidate) => {
      remoteOids.set(candidate.publicationId, candidate.expectedOid);
      return Promise.resolve(candidate.expectedOid);
    });
    const completed = await new ResumablePublicationExecutor(
      store,
      adapter({ remoteOids, mergeRequests, push: resumedPush }),
    ).publish({ changeId: 'resume', runId: 'run-resume', items });

    expect(resumedPush.mock.calls.map(([candidate]) => candidate.publicationId)).toEqual([
      'specification',
    ]);
    expect(completed.items.every((item) => item.status === 'published')).toBe(true);
    expect(completed.items.map((item) => item.result?.provenance)).toEqual([
      'runtime-created',
      'runtime-created',
      'runtime-created',
    ]);
  });

  it('never repeats merge-request creation while its result is unknown', async () => {
    const item = intent('app', 'app', 'business');
    const store = new MemoryStore();
    const remoteOids = new Map([[item.publicationId, item.expectedOid]]);
    const mergeRequests = new Map<string, PublicationReceiptItem>();
    const firstCreate = vi
      .fn<PublicationItemExecutor['createMergeRequest']>()
      .mockRejectedValue(new Error('create response and observation unavailable'));

    await expect(
      new ResumablePublicationExecutor(
        store,
        adapter({ remoteOids, mergeRequests, createMergeRequest: firstCreate }),
      ).publish({ changeId: 'unknown-mr', runId: 'run-unknown-mr', items: [item] }),
    ).rejects.toBeInstanceOf(PublicationResultUnknownError);
    expect(store.journal?.items[0]?.status).toBe('mr-unknown');
    expect(firstCreate).toHaveBeenCalledOnce();

    const forbiddenCreate = vi.fn<PublicationItemExecutor['createMergeRequest']>();
    await expect(
      new ResumablePublicationExecutor(
        store,
        adapter({ remoteOids, mergeRequests, createMergeRequest: forbiddenCreate }),
      ).publish({ changeId: 'unknown-mr', runId: 'run-unknown-mr', items: [item] }),
    ).rejects.toBeInstanceOf(PublicationResultUnknownError);
    expect(forbiddenCreate).not.toHaveBeenCalled();

    mergeRequests.set(item.publicationId, result(item));
    await expect(
      new ResumablePublicationExecutor(
        store,
        adapter({ remoteOids, mergeRequests, createMergeRequest: forbiddenCreate }),
      ).publish({ changeId: 'unknown-mr', runId: 'run-unknown-mr', items: [item] }),
    ).resolves.toMatchObject({ items: [{ status: 'published', result: { provenance: 'recovered' } }] });
    expect(forbiddenCreate).not.toHaveBeenCalled();
  });

  it('rejects duplicate stable identities and exposes no destructive publication operation', () => {
    const duplicate = intent('app', 'app', 'business');
    expect(() =>
      createPublicationJournal({
        changeId: 'duplicate',
        runId: 'run-duplicate',
        items: [duplicate, duplicate],
      }),
    ).toThrow(/duplicate stable operations/u);
    expect(JSON.stringify(intent('safe', 'app', 'business'))).not.toMatch(
      /force|rebase|delete|merge"/u,
    );
  });
});
