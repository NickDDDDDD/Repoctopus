import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createConsistencyReviewReceipt,
  type ConsistencyReviewReceipt,
  type ConsistencyReviewRequest,
  type ConsistencyReviewVerdict,
} from '../domains/consistency/review.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { FileConsistencyStore } from '../platform/consistency/file-consistency-store.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';

export interface ConsistencySemanticAssessment {
  behaviorContractChanged: boolean | null;
  evidenceSufficient: boolean;
  rationale: string;
  semanticFindings: Array<{
    category:
      | 'implementation'
      | 'test'
      | 'pipeline'
      | 'api'
      | 'config'
      | 'permission'
      | 'data'
      | 'scope';
    effect: 'none' | 'changed' | 'uncertain';
    evidenceIds: string[];
    summary: string;
  }>;
}

export interface ConsistencyReviewWorkPackage {
  schemaVersion: 1;
  kind: 'ConsistencyReviewWorkPackage';
  request: ConsistencyReviewRequest;
  skill: SkillUsageSnapshot;
  inputDigest: `sha256:${string}`;
}

export interface ConsistencyHumanDecisionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  decisionType: 'consistency-impact';
  requestId: string;
  reviewRequestId: string;
  inputDigest: `sha256:${string}`;
  recommendation: Exclude<ConsistencyReviewVerdict, 'no-spec-impact'>;
  rationale: string;
  options: ['no-spec-impact', 'spec-update-required'];
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function evaluateConsistencyAssessment(input: {
  work: ConsistencyReviewWorkPackage;
  assessment: ConsistencySemanticAssessment;
  reviewedAt: string;
}): { receipt: ConsistencyReviewReceipt | null; decision: ConsistencyHumanDecisionRequest | null } {
  const { assessment, work } = input;
  if (!assessment.rationale.trim() || assessment.semanticFindings.length === 0) {
    throw new Error('Consistency assessment requires semantic findings and rationale');
  }
  const evidenceIds = assessment.semanticFindings.flatMap((finding) => finding.evidenceIds);
  if (
    evidenceIds.length === 0 ||
    assessment.semanticFindings.some((finding) => !finding.summary.trim())
  ) {
    throw new Error('Consistency assessment requires bounded evidence mappings');
  }
  const explicitChanges = assessment.semanticFindings.some(
    (finding) =>
      finding.effect === 'changed' &&
      ['api', 'config', 'permission', 'data', 'scope'].includes(finding.category),
  );
  const uncertain =
    !assessment.evidenceSufficient ||
    assessment.behaviorContractChanged === null ||
    assessment.semanticFindings.some((finding) => finding.effect === 'uncertain') ||
    (assessment.behaviorContractChanged === false && explicitChanges);
  const verdict: ConsistencyReviewVerdict = uncertain
    ? 'uncertain'
    : assessment.behaviorContractChanged || explicitChanges
      ? 'spec-update-required'
      : 'no-spec-impact';
  const affectedPublicationIds = work.request.observations
    .filter((observation) => observation.currentHeadOid !== observation.publishedHeadOid)
    .map((observation) => observation.publicationId);
  if (verdict === 'no-spec-impact') {
    return {
      receipt: createConsistencyReviewReceipt({
        request: work.request,
        verdict,
        rationale: assessment.rationale,
        evidenceIds,
        affectedPublicationIds,
        reviewedAt: input.reviewedAt,
      }),
      decision: null,
    };
  }
  return {
    receipt: null,
    decision: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'HumanDecisionRequest',
      decisionType: 'consistency-impact',
      requestId: digest({ review: work.request.requestId, work: work.inputDigest, verdict }),
      reviewRequestId: work.request.requestId,
      inputDigest: work.inputDigest,
      recommendation: verdict,
      rationale: assessment.rationale,
      options: ['no-spec-impact', 'spec-update-required'],
    },
  };
}

export class ConsistencyReviewService extends Service {
  static inject = ['skills'];
  private readonly store: FileConsistencyStore;

  constructor(
    context: Context,
    private readonly config: { workspaceRoot: string },
  ) {
    super(context, 'consistencyReview');
    this.store = new FileConsistencyStore(config.workspaceRoot);
  }

  async prepare(
    request: ConsistencyReviewRequest,
    signal?: AbortSignal,
  ): Promise<ConsistencyReviewWorkPackage> {
    const skill = await this.ctx.skills.get('to-spec', { cwd: this.config.workspaceRoot, signal });
    if (!skill || skill.provider !== 'matt-consistency-method') {
      throw new Error('Consistency review requires the fixed to-spec method provider');
    }
    const snapshot = await snapshotSkillDefinition(skill);
    const unsigned = {
      schemaVersion: 1 as const,
      kind: 'ConsistencyReviewWorkPackage' as const,
      request: structuredClone(request),
      skill: snapshot,
    };
    return { ...unsigned, inputDigest: digest(unsigned) };
  }

  async record(input: {
    work: ConsistencyReviewWorkPackage;
    assessment: ConsistencySemanticAssessment;
    reviewedAt: string;
  }): Promise<ReturnType<typeof evaluateConsistencyAssessment>> {
    const current = await this.prepare(input.work.request);
    if (current.inputDigest !== input.work.inputDigest) {
      throw new Error('Consistency review method or bounded input changed');
    }
    const result = evaluateConsistencyAssessment(input);
    if (result.receipt) await this.store.saveReceipt(result.receipt);
    return result;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    consistencyReview: ConsistencyReviewService;
  }
}
