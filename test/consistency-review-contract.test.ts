import { describe, expect, it } from 'vitest';

import {
  createConsistencyReviewReceipt,
  createConsistencyReviewRequest,
} from '../domains/consistency/review.js';
import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
} from '../domains/delivery/publication-receipt.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const receipt = createPublicationReceipt({
  apiVersion: PUBLICATION_RECEIPT_API_VERSION,
  kind: 'PublicationReceipt',
  schemaVersion: 1,
  changeId: 'consistency',
  generation: 1,
  runId: 'run-consistency',
  deliverySnapshotDigest: digest('1'),
  verificationInputDigest: digest('2'),
  evidenceBundleIds: ['bundle'],
  specificationClosure: { closureId: digest('3'), planDigest: digest('4') },
  items: [
    {
      publicationId: 'business',
      role: 'business',
      deliveryId: 'business',
      repositoryId: 'app',
      remoteIdentity: 'team/app',
      remote: 'origin',
      sourceBranch: 'feature/consistency',
      targetBranch: 'main',
      publishedOid: 'a'.repeat(40),
      mergeRequest: {
        provider: 'github',
        repositoryId: 'app',
        number: 7,
        url: 'https://github.com/team/app/pull/7',
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
      sourceBranch: 'spec/consistency',
      targetBranch: 'main',
      publishedOid: 'b'.repeat(40),
      mergeRequest: {
        provider: 'github',
        repositoryId: 'workspace',
        number: 8,
        url: 'https://github.com/team/workspace/pull/8',
      },
      provenance: 'runtime-created',
      verifiedAt: '2026-10-24T00:00:00.000Z',
    },
  ],
});

function request() {
  return createConsistencyReviewRequest({
    receipt,
    observations: [
      {
        publicationId: 'business',
        repositoryId: 'app',
        provider: 'github',
        number: 7,
        url: 'https://github.com/team/app/pull/7',
        sourceBranch: 'feature/consistency',
        targetBranch: 'main',
        publishedHeadOid: 'a'.repeat(40),
        currentHeadOid: 'c'.repeat(40),
        currentState: 'open',
        observedAt: '2026-10-24T01:00:00.000Z',
        changeEvidence: {
          summary: 'Public API response changed',
          diffDigest: digest('5'),
          categories: ['api'],
        },
      },
    ],
  });
}

describe('Consistency Review contracts', () => {
  it('binds bounded remote evidence without mutating the original Run or Publication Receipt', () => {
    const original = structuredClone(receipt);
    const reviewRequest = request();
    const reviewReceipt = createConsistencyReviewReceipt({
      request: reviewRequest,
      verdict: 'spec-update-required',
      rationale: 'The public response contract changed.',
      evidenceIds: ['diff:5'],
      affectedPublicationIds: ['business'],
      followUpChangeId: 'reconcile-consistency-1',
      reviewedAt: '2026-10-24T01:01:00.000Z',
    });
    expect(receipt).toEqual(original);
    expect(reviewReceipt).toMatchObject({
      changeId: receipt.changeId,
      requestDigest: reviewRequest.digest,
      verdict: 'spec-update-required',
      followUpChangeId: 'reconcile-consistency-1',
    });
    const serialized = JSON.stringify({ reviewRequest, reviewReceipt });
    expect(serialized).not.toMatch(/"(?:body|fullDiff|credential|token|absolutePath)"/iu);
    expect(serialized).not.toContain('C:\\');
  });

  it('supports all verdicts and rejects receipt mismatch or unbounded evidence', () => {
    for (const verdict of ['no-spec-impact', 'spec-update-required', 'uncertain'] as const) {
      expect(
        createConsistencyReviewReceipt({
          request: request(),
          verdict,
          rationale: 'Bounded assessment',
          evidenceIds: ['evidence'],
          affectedPublicationIds: ['business'],
          reviewedAt: '2026-10-24T01:01:00.000Z',
        }).verdict,
      ).toBe(verdict);
    }
    const observation = request().observations[0]!;
    expect(() =>
      createConsistencyReviewRequest({ receipt, observations: [{ ...observation, number: 99 }] }),
    ).toThrow(/does not match/u);
    expect(() =>
      createConsistencyReviewReceipt({
        request: request(),
        verdict: 'uncertain',
        rationale: 'Review C:/private/source.ts',
        evidenceIds: [],
        affectedPublicationIds: [],
        reviewedAt: '2026-10-24T01:01:00.000Z',
      }),
    ).toThrow(/absolute filesystem path/u);
  });
});
