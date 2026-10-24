import { describe, expect, it } from 'vitest';

import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
} from '../domains/delivery/publication-receipt.js';
import { reconcilePublicationReceipts } from '../services/consistency-reconciler.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const publication = createPublicationReceipt({
  apiVersion: PUBLICATION_RECEIPT_API_VERSION,
  kind: 'PublicationReceipt',
  schemaVersion: 1,
  changeId: 'pull-reconcile',
  generation: 1,
  runId: 'run-reconcile',
  deliverySnapshotDigest: digest('1'),
  verificationInputDigest: digest('2'),
  evidenceBundleIds: ['bundle'],
  specificationClosure: { closureId: digest('3'), planDigest: digest('4') },
  items: [
    {
      publicationId: 'app',
      role: 'business',
      deliveryId: 'app',
      repositoryId: 'app',
      remoteIdentity: 'team/app',
      remote: 'origin',
      sourceBranch: 'feature/reconcile',
      targetBranch: 'main',
      publishedOid: 'a'.repeat(40),
      mergeRequest: {
        provider: 'github',
        repositoryId: 'app',
        number: 1,
        url: 'https://github.com/team/app/pull/1',
      },
      provenance: 'runtime-created',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    },
    {
      publicationId: 'specification',
      role: 'specification',
      repositoryId: 'workspace',
      remoteIdentity: 'team/workspace',
      remote: 'origin',
      sourceBranch: 'spec/reconcile',
      targetBranch: 'main',
      publishedOid: 'b'.repeat(40),
      mergeRequest: {
        provider: 'github',
        repositoryId: 'workspace',
        number: 2,
        url: 'https://github.com/team/workspace/pull/2',
      },
      provenance: 'runtime-created',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    },
  ],
});

function status(headCommit: string) {
  return {
    provider: 'github',
    repositoryId: 'app',
    number: 1,
    url: 'https://github.com/team/app/pull/1',
    state: 'open' as const,
    sourceBranch: 'feature/reconcile',
    targetBranch: 'main',
    headCommit,
    ci: 'unknown' as const,
    review: 'unknown' as const,
    conversationsResolved: null,
    mergeCommit: null,
    mergedAt: null,
  };
}

describe('bounded pull reconciliation', () => {
  it('is a no-op for an unchanged head and exits without timers or waiting state', async () => {
    const saved: unknown[] = [];
    const result = await reconcilePublicationReceipts({
      publications: [publication],
      observe: () => Promise.resolve(status('a'.repeat(40))),
      saveRequest: (request) => {
        saved.push(request);
        return Promise.resolve();
      },
      now: () => new Date('2026-10-24T01:00:00.000Z'),
    });
    expect(result).toEqual({ checked: 1, unchanged: 1, reviewRequests: [], diagnostics: [] });
    expect(saved).toEqual([]);
  });

  it('persists bounded drift and degrades platform failure to a diagnostic', async () => {
    const saved: unknown[] = [];
    const drift = await reconcilePublicationReceipts({
      publications: [publication],
      observe: () => Promise.resolve(status('c'.repeat(40))),
      saveRequest: (request) => {
        saved.push(request);
        return Promise.resolve();
      },
      now: () => new Date('2026-10-24T01:00:00.000Z'),
    });
    expect(drift).toMatchObject({
      checked: 1,
      unchanged: 0,
      reviewRequests: [{ changeId: 'pull-reconcile' }],
      diagnostics: [],
    });
    expect(saved).toHaveLength(1);
    const unavailable = await reconcilePublicationReceipts({
      publications: [publication],
      observe: () => Promise.reject(new Error('network unavailable')),
      saveRequest: () => Promise.reject(new Error('must not save')),
    });
    expect(unavailable).toMatchObject({
      checked: 1,
      unchanged: 0,
      reviewRequests: [],
      diagnostics: [{ level: 'warning', code: 'consistency.reconcile-unavailable' }],
    });
  });
});
