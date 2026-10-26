import { describe, expect, it } from 'vitest';

import {
  ResumablePublicationExecutor,
  createPublicationJournal,
  type PublicationItemExecutor,
  type PublicationJournal,
  type PublicationJournalItemIntent,
  type PublicationJournalStore,
} from '../domains/delivery/publication-journal.js';
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
    provenance: 'recovered',
    verifiedAt: '2026-10-24T00:00:00.000Z',
  };
}

describe('resumable multi-repository publication', () => {
  it('continues from the first unconfirmed item with a different short-lived executor', async () => {
    const items = [
      intent('app', 'app', 'business'),
      intent('backend', 'backend', 'business'),
      intent('specification', 'workspace', 'specification'),
    ];
    const store = new MemoryStore();
    const remote = new Map<string, PublicationReceiptItem>();
    const first: PublicationItemExecutor = {
      observe: (candidate) => Promise.resolve(remote.get(candidate.publicationId) ?? null),
      execute: (candidate) => {
        if (candidate.publicationId === 'backend') {
          return Promise.reject(new Error('backend unavailable'));
        }
        const receipt = result(candidate);
        remote.set(candidate.publicationId, receipt);
        return Promise.resolve(receipt);
      },
    };
    await expect(
      new ResumablePublicationExecutor(store, first).publish({
        changeId: 'resume',
        runId: 'run-resume',
        items,
      }),
    ).rejects.toThrow(/backend/u);
    expect(
      Object.fromEntries(
        store.journal!.items.map((item) => [item.intent.publicationId, item.status]),
      ),
    ).toEqual({ app: 'published', backend: 'failed', specification: 'pending' });

    const executions: string[] = [];
    const second: PublicationItemExecutor = {
      observe: (candidate) => Promise.resolve(remote.get(candidate.publicationId) ?? null),
      execute: (candidate) => {
        executions.push(candidate.publicationId);
        const receipt = result(candidate);
        remote.set(candidate.publicationId, receipt);
        if (candidate.publicationId === 'backend') {
          return Promise.reject(new Error('response lost after publish'));
        }
        return Promise.resolve(receipt);
      },
    };
    const completed = await new ResumablePublicationExecutor(store, second).publish({
      changeId: 'resume',
      runId: 'run-resume',
      items,
    });
    expect(executions).toEqual(['backend', 'specification']);
    expect(completed.items.every((item) => item.status === 'published')).toBe(true);
    expect(remote.size).toBe(3);
    expect(completed.items.map((item) => item.result?.provenance)).toEqual([
      'recovered',
      'recovered',
      'recovered',
    ]);
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
