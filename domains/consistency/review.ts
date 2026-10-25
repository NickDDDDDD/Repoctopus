import { createHash } from 'node:crypto';

import type { PublicationReceipt } from '../delivery/publication-receipt.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export const CONSISTENCY_REVIEW_API_VERSION = 'repoctopus.consistency/v1alpha1' as const;
export type ConsistencyReviewVerdict = 'no-spec-impact' | 'spec-update-required' | 'uncertain';

export interface ConsistencyMergeRequestObservation {
  publicationId: string;
  repositoryId: string;
  provider: string;
  number: number;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  publishedHeadOid: string;
  currentHeadOid: string;
  currentState: 'open' | 'closed' | 'merged';
  observedAt: string;
  changeEvidence: {
    summary: string;
    diffDigest: `sha256:${string}`;
    categories: Array<
      'implementation' | 'test' | 'pipeline' | 'api' | 'config' | 'permission' | 'data' | 'mixed'
    >;
  };
}

export interface ConsistencyReviewRequest {
  apiVersion: typeof CONSISTENCY_REVIEW_API_VERSION;
  kind: 'ConsistencyReviewRequest';
  schemaVersion: 1;
  requestId: `sha256:${string}`;
  changeId: string;
  generation: number;
  originalRunId: string;
  publicationReceiptDigest: `sha256:${string}`;
  verificationInputDigest: `sha256:${string}`;
  specificationClosure: PublicationReceipt['specificationClosure'];
  observations: ConsistencyMergeRequestObservation[];
  digest: `sha256:${string}`;
}

export interface ConsistencyReviewReceipt {
  apiVersion: typeof CONSISTENCY_REVIEW_API_VERSION;
  kind: 'ConsistencyReviewReceipt';
  schemaVersion: 1;
  requestId: `sha256:${string}`;
  requestDigest: `sha256:${string}`;
  changeId: string;
  verdict: ConsistencyReviewVerdict;
  rationale: string;
  evidenceIds: string[];
  affectedPublicationIds: string[];
  followUpChangeId: string | null;
  reviewedAt: string;
  digest: `sha256:${string}`;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function assertBounded(value: unknown): void {
  const json = JSON.stringify(value);
  if (/"(?:body|fullDiff|credential|token|absolutePath)"\s*:/iu.test(json)) {
    throw new Error('Consistency review contains forbidden unbounded or secret fields');
  }
  if (/(?:^|[\s"'])[a-zA-Z]:[\\/]|"\/[a-zA-Z0-9._-]+\//u.test(json)) {
    throw new Error('Consistency review contains an absolute filesystem path');
  }
}

export function createConsistencyReviewRequest(input: {
  receipt: PublicationReceipt;
  observations: readonly ConsistencyMergeRequestObservation[];
}): ConsistencyReviewRequest {
  const business = input.receipt.items.filter((item) => item.role === 'business');
  const observations = input.observations
    .map((observation) => {
      const publication = business.find((item) => item.publicationId === observation.publicationId);
      if (
        !publication ||
        observation.repositoryId !== publication.repositoryId ||
        observation.provider !== publication.mergeRequest.provider ||
        observation.number !== publication.mergeRequest.number ||
        observation.url !== publication.mergeRequest.url ||
        observation.sourceBranch !== publication.sourceBranch ||
        observation.targetBranch !== publication.targetBranch ||
        observation.publishedHeadOid !== publication.publishedOid ||
        !/^[a-f0-9]{40,64}$/u.test(observation.currentHeadOid) ||
        !SHA256.test(observation.changeEvidence.diffDigest) ||
        !observation.changeEvidence.summary.trim() ||
        Number.isNaN(Date.parse(observation.observedAt))
      ) {
        throw new Error(
          `Consistency observation does not match Publication Receipt: ${observation.publicationId}`,
        );
      }
      return structuredClone(observation);
    })
    .sort((left, right) => left.publicationId.localeCompare(right.publicationId));
  if (
    observations.length !== business.length ||
    new Set(observations.map((item) => item.publicationId)).size !== observations.length
  ) {
    throw new Error('Consistency review must cover every Business publication exactly once');
  }
  const identity = {
    changeId: input.receipt.changeId,
    generation: input.receipt.generation,
    originalRunId: input.receipt.runId,
    publicationReceiptDigest: input.receipt.digest,
  };
  const unsigned = {
    apiVersion: CONSISTENCY_REVIEW_API_VERSION,
    kind: 'ConsistencyReviewRequest' as const,
    schemaVersion: 1 as const,
    requestId: sha256(identity),
    ...identity,
    verificationInputDigest: input.receipt.verificationInputDigest,
    specificationClosure: structuredClone(input.receipt.specificationClosure),
    observations,
  };
  assertBounded(unsigned);
  return { ...unsigned, digest: sha256(unsigned) };
}

export function createConsistencyReviewReceipt(input: {
  request: ConsistencyReviewRequest;
  verdict: ConsistencyReviewVerdict;
  rationale: string;
  evidenceIds: readonly string[];
  affectedPublicationIds: readonly string[];
  followUpChangeId?: string | null;
  reviewedAt: string;
}): ConsistencyReviewReceipt {
  if (!input.rationale.trim() || Number.isNaN(Date.parse(input.reviewedAt))) {
    throw new Error('Consistency Review Receipt rationale or time is invalid');
  }
  const available = new Set(input.request.observations.map((item) => item.publicationId));
  if (input.affectedPublicationIds.some((id) => !available.has(id))) {
    throw new Error('Consistency Review Receipt references an unknown publication');
  }
  const unsigned = {
    apiVersion: CONSISTENCY_REVIEW_API_VERSION,
    kind: 'ConsistencyReviewReceipt' as const,
    schemaVersion: 1 as const,
    requestId: input.request.requestId,
    requestDigest: input.request.digest,
    changeId: input.request.changeId,
    verdict: input.verdict,
    rationale: input.rationale,
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
    affectedPublicationIds: [...new Set(input.affectedPublicationIds)].sort(),
    followUpChangeId: input.followUpChangeId ?? null,
    reviewedAt: input.reviewedAt,
  };
  assertBounded(unsigned);
  return { ...unsigned, digest: sha256(unsigned) };
}
