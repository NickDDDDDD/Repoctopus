import { Service, type Context } from '@deepseek-ai/cordis';
import type { ExecutionIsolation } from '../domains/change-lifecycle/build-protocol.js';
import type { HumanDecisionInteraction } from '../domains/change-lifecycle/human-decision.js';

import {
  assertSpecificationApprovalState,
  createPlanningSnapshot,
  createSpecificationApprovalMigrationPlan,
  recordSpecificationApprovalDecision,
  requestSpecificationApproval,
  type SpecificationApprovalStorePort,
} from '../domains/specification/planning-approval.js';
import type {
  ChangeBranchReference,
  SpecificationApprovalActor,
  SpecificationApprovalDecisionResponse,
  SpecificationApprovalState,
  SpecificationValidation,
  SpecificationArtifact,
  PlanningSnapshot,
  SpecificationApprovalMigrationPlan,
  SpecificationPlanningManifest,
} from '../domains/specification/types.js';
import { FilePlanningApprovalStore } from '../platform/specification/file-planning-approval-store.js';

export interface SpecificationPlanningConfig {
  workspaceRoot: string;
}

export interface PrepareSpecificationApprovalInput {
  changeId: string;
  decisionRunId?: string;
  approvalPhase?: 'open' | 'design';
  changeBranch: ChangeBranchReference;
  requestId?: string;
  forceNewApproval?: boolean;
  buildStrategyDigest?: `sha256:${string}`;
  now?: () => Date;
  signal?: AbortSignal;
  preflight?: (input: {
    manifest: SpecificationPlanningManifest;
    validation: SpecificationValidation;
    snapshot: PlanningSnapshot;
  }) => Promise<{ evidenceDigests: readonly `sha256:${string}`[] }>;
}

export interface DesignGateAssessment {
  status: 'blocked' | 'waiting' | 'approved';
  reason: string;
  evidenceDigests: `sha256:${string}`[];
  validation?: SpecificationValidation;
  snapshot?: PlanningSnapshot;
  approval?: SpecificationApprovalState;
  observation?: {
    artifacts: SpecificationArtifact[];
    validation: SpecificationValidation;
  };
}

export interface OpenApprovalRevalidation {
  status: 'accepted' | 'invalid' | 'unavailable';
  reason: string;
  source?: 'provider-artifacts' | 'strict-validation' | 'approval-drift';
  reasonCode?: 'provider-artifacts-invalid' | 'strict-validation-invalid' | 'approval-drift';
  evidenceDigests: `sha256:${string}`[];
  validation?: SpecificationValidation;
  snapshot?: PlanningSnapshot;
  observation?: {
    artifacts: SpecificationArtifact[];
    validation: SpecificationValidation;
  };
}

export interface PlanningAuthorityObservation {
  status: 'authorized' | 'invalid';
  observationKind: 'same' | 'semantic' | 'approval-authority' | 'publication' | 'unknown';
  invalidationKind: 'semantic' | 'approval-authority' | null;
  planningDigest: `sha256:${string}`;
  reasonCode:
    | 'authorized'
    | 'planning-incomplete'
    | 'strict-validation-failed'
    | 'semantic-drift'
    | 'approval-missing'
    | 'approval-stale';
  reason: string;
  evidenceDigests: `sha256:${string}`[];
  snapshot: PlanningSnapshot | null;
}

export class SpecificationPlanning extends Service {
  static inject = ['specification'];
  private readonly store: SpecificationApprovalStorePort;

  constructor(
    context: Context,
    config: SpecificationPlanningConfig,
    store: SpecificationApprovalStorePort = new FilePlanningApprovalStore(config.workspaceRoot),
  ) {
    super(context, 'specificationPlanning');
    this.store = store;
  }

  status(
    changeId: string,
    approvalPhase: 'open' | 'design' = 'design',
  ): Promise<SpecificationApprovalState | null> {
    return this.store.load(changeId, approvalPhase);
  }

  async migrationPlan(changeId: string): Promise<SpecificationApprovalMigrationPlan> {
    const current = await this.store.load(changeId);
    if (!current) throw new Error(`Specification approval does not exist: ${changeId}`);
    return createSpecificationApprovalMigrationPlan(current);
  }

  async prepare(input: PrepareSpecificationApprovalInput): Promise<SpecificationApprovalState> {
    const assessment = await this.assess(input);
    if (!assessment.approval) throw new Error(assessment.reason);
    return assessment.approval;
  }

  async assess(input: PrepareSpecificationApprovalInput): Promise<DesignGateAssessment> {
    let collected: Awaited<ReturnType<SpecificationPlanning['collect']>>;
    try {
      collected = await this.collect(input);
    } catch (error) {
      return {
        status: 'blocked',
        reason: error instanceof Error ? error.message : 'Specification planning assessment failed',
        evidenceDigests: [],
      };
    }
    const { manifest, validation, current } = collected;
    const observation = {
      artifacts: structuredClone(manifest.change.artifacts),
      validation: structuredClone(validation),
    };
    const { change, schema, specificationRoot } = manifest;
    const evidenceDigests = [schema.digest, change.changeDigest, validation.validationDigest];
    if (!change.planningComplete) {
      return {
        status: 'blocked',
        reason: 'Specification planning is incomplete',
        evidenceDigests,
        validation,
        observation,
      };
    }
    if (!validation.strict || !validation.valid) {
      return {
        status: 'blocked',
        reason: 'Specification planning requires successful strict validation',
        evidenceDigests,
        validation,
        observation,
      };
    }
    let snapshot: PlanningSnapshot;
    try {
      snapshot = createPlanningSnapshot({
        change,
        validation,
        schema,
        specificationRoot,
        changeBranch: input.changeBranch,
        planningManifest: manifest,
        approvalPhase: input.approvalPhase ?? 'design',
        ...(input.buildStrategyDigest ? { buildStrategyDigest: input.buildStrategyDigest } : {}),
      });
    } catch (error) {
      return {
        status: 'blocked',
        reason: error instanceof Error ? error.message : 'Specification planning manifest failed',
        evidenceDigests,
        validation,
        observation,
      };
    }
    if (input.preflight) {
      try {
        const preflight = await input.preflight({
          manifest: structuredClone(manifest),
          validation: structuredClone(validation),
          snapshot: structuredClone(snapshot),
        });
        if (preflight.evidenceDigests.some((digest) => !/^sha256:[a-f0-9]{64}$/u.test(digest))) {
          throw new Error('Specification planning preflight returned an invalid evidence digest');
        }
        const currentManifest = await this.ctx.specification.planningManifest(
          input.changeId,
          input.signal,
        );
        if (currentManifest.semanticDigest !== manifest.semanticDigest) {
          throw new Error('Specification planning changed during preflight');
        }
        evidenceDigests.push(...new Set(preflight.evidenceDigests));
      } catch (error) {
        return {
          status: 'blocked',
          reason:
            error instanceof Error ? error.message : 'Specification planning preflight failed',
          evidenceDigests,
          validation,
          snapshot,
          observation,
        };
      }
    }
    let next = requestSpecificationApproval({
      current,
      snapshot,
      timestamp: (input.now ?? (() => new Date()))().toISOString(),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.decisionRunId ? { decisionRunId: input.decisionRunId } : {}),
      ...(input.forceNewApproval ? { forceNewRequest: true } : {}),
    });
    if (current?.stateVersion !== next.stateVersion) {
      try {
        await this.store.commit(next, current?.stateVersion ?? null);
      } catch (error) {
        const latest = await this.store.load(input.changeId, input.approvalPhase ?? 'design');
        if (
          !latest ||
          latest.snapshot.digest !== next.snapshot.digest ||
          latest.decisionRequest.requestId !== next.decisionRequest.requestId ||
          latest.decisionRequest.proposalHash !== next.decisionRequest.proposalHash
        ) {
          throw error;
        }
        next = latest;
      }
    }
    if (
      next.status === 'approved' &&
      next.decision?.decision === 'approve' &&
      next.decision.approvalHash !== null &&
      next.decision.snapshotDigest === snapshot.digest
    ) {
      return {
        status: 'approved',
        reason: 'Specification planning is strictly valid and has a trusted Human Decision',
        evidenceDigests: [...evidenceDigests, snapshot.digest, next.decision.approvalHash],
        validation,
        snapshot,
        approval: next,
        observation,
      };
    }
    if (next.status === 'changes_requested' || next.status === 'rejected') {
      return {
        status: 'blocked',
        reason:
          next.status === 'changes_requested'
            ? 'Specification planning changes were requested'
            : 'Specification planning was rejected',
        evidenceDigests: [...evidenceDigests, snapshot.digest],
        validation,
        snapshot,
        approval: next,
        observation,
      };
    }
    return {
      status: 'waiting',
      reason: 'Specification planning is waiting for a trusted Human Decision',
      evidenceDigests: [...evidenceDigests, snapshot.digest],
      validation,
      snapshot,
      approval: next,
      observation,
    };
  }

  async revalidateOpenApproval(
    input: PrepareSpecificationApprovalInput & {
      expectedSnapshotDigest: `sha256:${string}`;
    },
  ): Promise<OpenApprovalRevalidation> {
    let collected: Awaited<ReturnType<SpecificationPlanning['collect']>>;
    try {
      collected = await this.collect({ ...input, approvalPhase: 'open' });
    } catch (error) {
      return {
        status: 'unavailable',
        reason:
          error instanceof Error ? error.message : 'Open approval revalidation is unavailable',
        evidenceDigests: [],
      };
    }
    const { manifest, validation, current } = collected;
    const observation = {
      artifacts: structuredClone(manifest.change.artifacts),
      validation: structuredClone(validation),
    };
    const evidenceDigests = [
      manifest.schema.digest,
      manifest.change.changeDigest,
      validation.validationDigest,
    ];
    const invalid = (
      source: NonNullable<OpenApprovalRevalidation['source']>,
      reasonCode: NonNullable<OpenApprovalRevalidation['reasonCode']>,
      reason: string,
      snapshot?: PlanningSnapshot,
    ): OpenApprovalRevalidation => ({
      status: 'invalid',
      source,
      reasonCode,
      reason,
      evidenceDigests: [...evidenceDigests, ...(snapshot ? [snapshot.digest] : [])],
      validation,
      ...(snapshot ? { snapshot } : {}),
      observation,
    });
    if (!manifest.change.planningComplete) {
      return invalid(
        'provider-artifacts',
        'provider-artifacts-invalid',
        'Open planning artifacts are incomplete after approval',
      );
    }
    if (!validation.strict || !validation.valid) {
      return invalid(
        'strict-validation',
        'strict-validation-invalid',
        'Open planning no longer passes strict validation',
      );
    }
    let snapshot: PlanningSnapshot;
    try {
      snapshot = createPlanningSnapshot({
        change: manifest.change,
        validation,
        schema: manifest.schema,
        specificationRoot: manifest.specificationRoot,
        changeBranch: input.changeBranch,
        planningManifest: manifest,
        approvalPhase: 'open',
      });
    } catch (error) {
      return invalid(
        'provider-artifacts',
        'provider-artifacts-invalid',
        error instanceof Error ? error.message : 'Open planning manifest is invalid',
      );
    }
    if (
      !current ||
      current.status !== 'approved' ||
      current.decision?.decision !== 'approve' ||
      !current.decision.approvalHash ||
      current.snapshot.digest !== input.expectedSnapshotDigest ||
      current.decision.snapshotDigest !== input.expectedSnapshotDigest ||
      snapshot.digest !== input.expectedSnapshotDigest
    ) {
      return invalid(
        'approval-drift',
        'approval-drift',
        'Current Open planning no longer matches the approved snapshot',
        snapshot,
      );
    }
    return {
      status: 'accepted',
      reason: 'Current Open planning still matches the trusted approval',
      evidenceDigests: [...evidenceDigests, snapshot.digest, current.decision.approvalHash],
      validation,
      snapshot,
      observation,
    };
  }

  async observeAuthority(
    input: Omit<PrepareSpecificationApprovalInput, 'changeBranch'> & {
      changeBranch?: ChangeBranchReference;
      expectedPlanningDigest: `sha256:${string}`;
    },
  ): Promise<PlanningAuthorityObservation> {
    let collected: Awaited<ReturnType<SpecificationPlanning['collect']>>;
    try {
      collected = await this.collect({ ...input, approvalPhase: 'design' });
    } catch (error) {
      return {
        status: 'invalid',
        observationKind: 'unknown',
        invalidationKind: 'semantic',
        planningDigest: input.expectedPlanningDigest,
        reasonCode: 'strict-validation-failed',
        reason:
          error instanceof Error ? error.message : 'Specification planning observation failed',
        evidenceDigests: [],
        snapshot: null,
      };
    }
    const { manifest, validation, current } = collected;
    const evidenceDigests = [
      manifest.semanticDigest,
      manifest.change.changeDigest,
      validation.validationDigest,
    ];
    const invalid = (
      invalidationKind: 'semantic' | 'approval-authority',
      reasonCode: Exclude<PlanningAuthorityObservation['reasonCode'], 'authorized'>,
      reason: string,
      snapshot: PlanningSnapshot | null = null,
    ): PlanningAuthorityObservation => ({
      status: 'invalid',
      observationKind: invalidationKind,
      invalidationKind,
      planningDigest: manifest.semanticDigest,
      reasonCode,
      reason,
      evidenceDigests,
      snapshot,
    });
    if (!manifest.change.planningComplete) {
      return invalid('semantic', 'planning-incomplete', 'Specification planning is incomplete');
    }
    if (!validation.strict || !validation.valid) {
      return invalid(
        'semantic',
        'strict-validation-failed',
        'Specification planning requires successful strict validation',
      );
    }
    if (manifest.semanticDigest !== input.expectedPlanningDigest) {
      return invalid(
        'semantic',
        'semantic-drift',
        'Specification planning semantics changed after Design approval',
      );
    }
    const changeBranch = input.changeBranch ?? current?.snapshot.changeBranch;
    if (!changeBranch) {
      return invalid(
        'approval-authority',
        'approval-missing',
        'Design planning approval is missing',
      );
    }
    const snapshot = createPlanningSnapshot({
      change: manifest.change,
      validation,
      schema: manifest.schema,
      specificationRoot: manifest.specificationRoot,
      changeBranch,
      planningManifest: manifest,
      approvalPhase: 'design',
      ...(input.buildStrategyDigest ? { buildStrategyDigest: input.buildStrategyDigest } : {}),
    });
    if (!current) {
      return invalid(
        'approval-authority',
        'approval-missing',
        'Design planning approval is missing',
        snapshot,
      );
    }
    try {
      assertSpecificationApprovalState(current);
    } catch {
      return invalid(
        'approval-authority',
        'approval-stale',
        'Design planning approval is invalid',
        snapshot,
      );
    }
    if (
      current.status !== 'approved' ||
      current.decision?.decision !== 'approve' ||
      !current.decision.approvalHash ||
      current.snapshot.digest !== snapshot.digest ||
      current.decision.snapshotDigest !== snapshot.digest
    ) {
      return invalid(
        'approval-authority',
        'approval-stale',
        'Design planning approval no longer authorizes the current planning snapshot',
        snapshot,
      );
    }
    return {
      status: 'authorized',
      observationKind:
        current.snapshot.publicationProvenanceDigest === snapshot.publicationProvenanceDigest
          ? 'same'
          : 'publication',
      invalidationKind: null,
      planningDigest: manifest.semanticDigest,
      reasonCode: 'authorized',
      reason: 'Specification planning remains strictly valid and approved',
      evidenceDigests: [...evidenceDigests, snapshot.digest, current.decision.approvalHash],
      snapshot,
    };
  }

  private async collect(
    input: Pick<PrepareSpecificationApprovalInput, 'changeId' | 'approvalPhase' | 'signal'>,
  ) {
    const [manifest, validation, current] = await Promise.all([
      this.ctx.specification.planningManifest(input.changeId, input.signal),
      this.ctx.specification.validate(input.changeId, {
        strict: true,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      this.store.load(input.changeId, input.approvalPhase ?? 'design'),
    ]);
    return { manifest, validation, current };
  }

  /** Observe a pending proposal without creating a request or changing approval state. */
  async assertCurrentProposal(
    changeId: string,
    approvalPhase: 'open' | 'design',
    requestId: string,
    proposalHash: string,
    changeBranch?: ChangeBranchReference,
  ): Promise<void> {
    const { manifest, validation, current } = await this.collect({ changeId, approvalPhase });
    if (
      !current ||
      current.decisionRequest.requestId !== requestId ||
      current.decisionRequest.proposalHash !== proposalHash
    )
      throw new Error('Human Decision proposal is stale or unavailable');
    if (!manifest.change.planningComplete || !validation.valid || !validation.strict)
      throw new Error('Human Decision requires complete, strictly valid planning artifacts');
    const snapshot = createPlanningSnapshot({
      change: manifest.change,
      validation,
      schema: manifest.schema,
      specificationRoot: manifest.specificationRoot,
      changeBranch: changeBranch ?? current.snapshot.changeBranch,
      planningManifest: manifest,
      approvalPhase,
      ...(current.snapshot.buildStrategyDigest
        ? { buildStrategyDigest: current.snapshot.buildStrategyDigest }
        : {}),
    });
    if (snapshot.digest !== current.snapshot.digest)
      throw new Error('Human Decision planning or Provider identity drifted');
  }

  async decide(input: {
    changeId: string;
    approvalPhase?: 'open' | 'design';
    response: SpecificationApprovalDecisionResponse;
    actor: SpecificationApprovalActor;
    now?: () => Date;
    recordedViaRunId?: string;
    isolation?: ExecutionIsolation;
    interaction?: HumanDecisionInteraction;
  }): Promise<SpecificationApprovalState> {
    const current = await this.store.load(input.changeId, input.approvalPhase ?? 'design');
    if (!current) throw new Error(`Specification approval does not exist: ${input.changeId}`);
    let next = recordSpecificationApprovalDecision({
      state: current,
      response: input.response,
      actor: input.actor,
      timestamp: (input.now ?? (() => new Date()))().toISOString(),
      ...(input.recordedViaRunId ? { recordedViaRunId: input.recordedViaRunId } : {}),
      ...(input.isolation ? { isolation: input.isolation } : {}),
      ...(input.interaction ? { interaction: input.interaction } : {}),
    });
    try {
      await this.store.commit(next, current.stateVersion);
    } catch (error) {
      const latest = await this.store.load(input.changeId, input.approvalPhase ?? 'design');
      if (
        !latest ||
        latest.decision?.requestId !== next.decision?.requestId ||
        latest.decision?.proposalHash !== next.decision?.proposalHash ||
        latest.decision?.decision !== next.decision?.decision ||
        latest.decision?.actorId !== next.decision?.actorId ||
        latest.decision?.source !== next.decision?.source
      ) {
        throw error;
      }
      next = latest;
    }
    return next;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    specificationPlanning: SpecificationPlanning;
  }
}
