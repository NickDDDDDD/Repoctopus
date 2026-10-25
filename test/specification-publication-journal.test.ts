import { describe, expect, it } from 'vitest';

import {
  assertSpecificationPublicationJournal,
  createSpecificationPublicationJournal,
  recordSpecificationPublicationCommit,
  recordSpecificationPublicationCompletion,
  recordSpecificationPublicationPush,
} from '../domains/delivery/specification-publication-journal.js';

const oid = 'a'.repeat(40);
const intent = {
  changeId: 'recoverable-archive',
  generation: 1,
  closureId: `sha256:${'b'.repeat(64)}` as const,
  planDigest: `sha256:${'c'.repeat(64)}` as const,
  checkoutId: 'closure-recoverable-archive',
  baseOid: 'd'.repeat(40),
  changedFiles: [
    'openspec/changes/recoverable-archive/proposal.md',
    'openspec/changes/archive/2026-10-25-recoverable-archive/proposal.md',
  ],
  repositoryId: 'workspace',
  remoteIdentity: 'github.com/team/workspace',
  remote: 'origin',
  sourceBranch: 'repoctopus/archive/recoverable-archive-bbbbbbbbbbbb',
  targetBranch: 'main',
  commitMessage: 'chore(spec): archive recoverable-archive',
};

describe('Specification publication Journal', () => {
  it('advances only through prepared, committed, pushed, completed', () => {
    const prepared = createSpecificationPublicationJournal(intent);
    const committed = recordSpecificationPublicationCommit(prepared, oid);
    const pushed = recordSpecificationPublicationPush(committed);
    const completed = recordSpecificationPublicationCompletion(pushed, {
      publicationId: 'specification:recoverable-archive:1',
      role: 'specification',
      repositoryId: intent.repositoryId,
      remoteIdentity: intent.remoteIdentity,
      remote: intent.remote,
      sourceBranch: intent.sourceBranch,
      targetBranch: intent.targetBranch,
      publishedOid: oid,
      mergeRequest: {
        provider: 'github',
        repositoryId: intent.repositoryId,
        number: 7,
        url: 'https://github.com/team/workspace/pull/7',
      },
      provenance: 'runtime-created',
      verifiedAt: '2026-10-25T00:00:00.000Z',
    });

    expect([prepared.state, committed.state, pushed.state, completed.state]).toEqual([
      'prepared',
      'committed',
      'pushed',
      'completed',
    ]);
    expect(new Set([prepared.digest, committed.digest, pushed.digest, completed.digest]).size).toBe(
      4,
    );
    expect(() => recordSpecificationPublicationPush(prepared)).toThrow(/no committed OID/i);
    expect(() => recordSpecificationPublicationCommit(committed, oid)).toThrow(
      /cannot move committed -> committed/i,
    );
    expect(() =>
      recordSpecificationPublicationCompletion(pushed, {
        ...completed.result!,
        publishedOid: 'e'.repeat(40),
      }),
    ).toThrow(/does not match its stable intent/i);
  });

  it('rejects identity and digest drift', () => {
    const journal = createSpecificationPublicationJournal(intent);
    expect(() =>
      assertSpecificationPublicationJournal({
        ...journal,
        intent: { ...journal.intent, checkoutId: 'another-checkout' },
      }),
    ).toThrow(/identity drifted/i);
    expect(() =>
      assertSpecificationPublicationJournal({
        ...journal,
        digest: `sha256:${'f'.repeat(64)}`,
      }),
    ).toThrow(/digest does not match/i);
  });
});
