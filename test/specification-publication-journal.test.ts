import { describe, expect, it } from 'vitest';

import {
  assertSpecificationPublicationJournal,
  createSpecificationPublicationJournal,
  recordSpecificationMergeRequestInvocation,
  recordSpecificationMergeRequestUnknown,
  recordSpecificationPublicationCommit,
  recordSpecificationPublicationCompletion,
  recordSpecificationPublicationPush,
  recordSpecificationPushInvocation,
  recordSpecificationPushUnknown,
} from '../domains/delivery/specification-publication-journal.js';

const oid = 'a'.repeat(40);
const intent = {
  changeId: 'recoverable-archive',
  runId: 'run-recoverable-archive',
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
  it('persists merge-request invocation and uncertainty before completion', () => {
    const prepared = createSpecificationPublicationJournal(intent);
    const committed = recordSpecificationPublicationCommit(prepared, oid);
    const pushInvoking = recordSpecificationPushInvocation(committed);
    const pushUnknown = recordSpecificationPushUnknown(pushInvoking);
    const pushed = recordSpecificationPublicationPush(pushUnknown);
    const invoking = recordSpecificationMergeRequestInvocation(pushed);
    const unknown = recordSpecificationMergeRequestUnknown(invoking);
    const completed = recordSpecificationPublicationCompletion(unknown, {
      publicationId: `specification:${intent.runId}`,
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

    expect([
      prepared.state,
      committed.state,
      pushInvoking.state,
      pushUnknown.state,
      pushed.state,
      invoking.state,
      unknown.state,
      completed.state,
    ]).toEqual([
      'prepared',
      'committed',
      'push-invoking',
      'push-unknown',
      'pushed',
      'mr-invoking',
      'mr-unknown',
      'completed',
    ]);
    expect(
      new Set([
        prepared.digest,
        committed.digest,
        pushInvoking.digest,
        pushUnknown.digest,
        pushed.digest,
        invoking.digest,
        unknown.digest,
        completed.digest,
      ]).size,
    ).toBe(8);
    expect(() => recordSpecificationPublicationPush(prepared)).toThrow(/no committed OID/i);
    expect(() => recordSpecificationPublicationCommit(committed, oid)).toThrow(
      /cannot move committed -> committed/i,
    );
    expect(() =>
      recordSpecificationPublicationCompletion(unknown, {
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
