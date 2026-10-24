import { describe, expect, it } from 'vitest';

import type {
  ConsistencyReviewWorkPackage,
  ConsistencySemanticAssessment,
} from '../services/consistency-review.js';
import { evaluateConsistencyAssessment } from '../services/consistency-review.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const work: ConsistencyReviewWorkPackage = {
  schemaVersion: 1,
  kind: 'ConsistencyReviewWorkPackage',
  request: {
    apiVersion: 'repoctopus.consistency/v1alpha1',
    kind: 'ConsistencyReviewRequest',
    schemaVersion: 1,
    requestId: digest('1'),
    changeId: 'semantic-review',
    generation: 1,
    originalRunId: 'run-semantic-review',
    publicationReceiptDigest: digest('2'),
    verificationInputDigest: digest('3'),
    specificationClosure: { closureId: digest('4'), planDigest: digest('5') },
    observations: [
      {
        publicationId: 'app',
        repositoryId: 'app',
        provider: 'github',
        number: 1,
        url: 'https://github.com/team/app/pull/1',
        sourceBranch: 'feature/review',
        targetBranch: 'main',
        publishedHeadOid: 'a'.repeat(40),
        currentHeadOid: 'b'.repeat(40),
        currentState: 'open',
        observedAt: '2026-10-24T00:00:00.000Z',
        changeEvidence: { summary: 'Head changed', diffDigest: digest('6'), categories: ['mixed'] },
      },
    ],
    digest: digest('7'),
  },
  skill: {
    schemaVersion: 1,
    name: 'to-spec',
    provider: 'matt-consistency-method',
    invocation: { modelInvocable: false, userInvocable: false },
    contentDigest: digest('8'),
    resourceManifestDigest: digest('9'),
  },
  inputDigest: digest('a'),
};

function assessment(
  category: ConsistencySemanticAssessment['semanticFindings'][number]['category'],
  changed: boolean | null,
  effect: 'none' | 'changed' | 'uncertain' = changed ? 'changed' : 'none',
): ConsistencySemanticAssessment {
  return {
    behaviorContractChanged: changed,
    evidenceSufficient: changed !== null,
    rationale: `Semantic assessment for ${category}`,
    semanticFindings: [
      {
        category,
        effect,
        evidenceIds: [`diff:${category}`],
        summary: `${category} evidence was reviewed semantically`,
      },
    ],
  };
}

describe('Consistency Review Service policy', () => {
  it.each(['implementation', 'test', 'pipeline'] as const)(
    'accepts explicit no-spec-impact for semantic %s-only changes',
    (category) => {
      const result = evaluateConsistencyAssessment({
        work,
        assessment: assessment(category, false),
        reviewedAt: '2026-10-24T01:00:00.000Z',
      });
      expect(result).toMatchObject({ receipt: { verdict: 'no-spec-impact' }, decision: null });
    },
  );

  it.each(['api', 'config', 'permission', 'data'] as const)(
    'routes %s contract changes to trusted human decision',
    (category) => {
      const result = evaluateConsistencyAssessment({
        work,
        assessment: assessment(category, true),
        reviewedAt: '2026-10-24T01:00:00.000Z',
      });
      expect(result).toMatchObject({
        receipt: null,
        decision: {
          recommendation: 'spec-update-required',
          options: ['no-spec-impact', 'spec-update-required'],
        },
      });
    },
  );

  it('routes mixed ambiguity to a human and rejects path-only conclusions', () => {
    const result = evaluateConsistencyAssessment({
      work,
      assessment: assessment('implementation', null, 'uncertain'),
      reviewedAt: '2026-10-24T01:00:00.000Z',
    });
    expect(result).toMatchObject({ receipt: null, decision: { recommendation: 'uncertain' } });
    expect(() =>
      evaluateConsistencyAssessment({
        work,
        assessment: {
          behaviorContractChanged: false,
          evidenceSufficient: true,
          rationale: 'Only src/internal.ts changed',
          semanticFindings: [],
        },
        reviewedAt: '2026-10-24T01:00:00.000Z',
      }),
    ).toThrow(/semantic findings/u);
  });
});
