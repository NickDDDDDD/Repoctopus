import { describe, expect, it } from 'vitest';

import type { MergeRequestInput, MergeRequestPort } from '../domains/delivery/ports.js';
import { observeOrCreateMergeRequest } from '../domains/delivery/stable-publication.js';
import type { MergeRequestIdentity, MergeRequestStatus } from '../domains/delivery/types.js';

const request: MergeRequestInput = {
  repositoryId: 'app',
  remoteIdentity: 'github.com/team/app',
  sourceBranch: 'feature/stable',
  targetBranch: 'main',
  title: 'Stable publication',
  body: 'Verified',
};
const expected = {
  changeId: 'stable',
  generation: 3,
  repositoryId: 'app',
  remoteIdentity: 'github.com/team/app',
  sourceBranch: 'feature/stable',
  targetBranch: 'main',
  publishedOid: 'a'.repeat(40),
};

function identity(number: number): MergeRequestIdentity {
  return {
    provider: 'github',
    repositoryId: 'app',
    number,
    url: `https://github.com/team/app/pull/${number}`,
  };
}

function status(id: MergeRequestIdentity, head = expected.publishedOid): MergeRequestStatus {
  return {
    ...id,
    state: 'merged',
    sourceBranch: expected.sourceBranch,
    targetBranch: expected.targetBranch,
    headCommit: head,
    ci: 'passed',
    review: 'approved',
    conversationsResolved: true,
    mergeCommit: 'b'.repeat(40),
    mergedAt: '2026-10-24T00:00:00.000Z',
  };
}

function port(candidates: MergeRequestIdentity[]): MergeRequestPort & { creates: number } {
  return {
    creates: 0,
    capability: () => Promise.reject(new Error('not used')),
    find: () => Promise.resolve(candidates[0] ?? null),
    findAll: () => Promise.resolve([...candidates]),
    create() {
      this.creates += 1;
      return Promise.resolve(identity(99));
    },
    update: () => Promise.reject(new Error('not used')),
    status: (id) => Promise.resolve(status(id)),
  };
}

describe('stable external publication recovery', () => {
  it('adopts a unique human MR independent of open/merged/closed state', async () => {
    const adapter = port([identity(1)]);
    const result = await observeOrCreateMergeRequest({
      port: adapter,
      request,
      identity: expected,
    });
    expect(result).toMatchObject({ provenance: 'human-created', identity: { number: 1 } });
    expect(adapter.creates).toBe(0);
  });

  it('observes after a lost create response and records recovered provenance', async () => {
    let candidates: MergeRequestIdentity[] = [];
    const adapter = port(candidates);
    adapter.findAll = () => Promise.resolve([...candidates]);
    adapter.create = () => {
      adapter.creates += 1;
      candidates = [identity(2)];
      return Promise.reject(new Error('response lost'));
    };
    const result = await observeOrCreateMergeRequest({
      port: adapter,
      request,
      identity: expected,
    });
    expect(result).toMatchObject({ provenance: 'recovered', identity: { number: 2 } });
    expect(adapter.creates).toBe(1);
  });

  it('fails closed for ambiguous or OID-mismatched observations', async () => {
    await expect(
      observeOrCreateMergeRequest({
        port: port([identity(1), identity(2)]),
        request,
        identity: expected,
      }),
    ).rejects.toThrow(/ambiguous/u);
    const mismatch = port([identity(1)]);
    mismatch.status = (id) => Promise.resolve(status(id, 'c'.repeat(40)));
    await expect(
      observeOrCreateMergeRequest({ port: mismatch, request, identity: expected }),
    ).rejects.toThrow(/none match/u);
  });
});
