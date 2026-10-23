import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createPlanningSnapshot,
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
  PlanningSnapshot,
} from '../domains/specification/types.js';
import { FilePlanningApprovalStore } from '../platform/specification/file-planning-approval-store.js';

export interface SpecificationPlanningConfig {
  workspaceRoot: string;
}

export interface PrepareSpecificationApprovalInput {
  changeId: string;
  changeBranch: ChangeBranchReference;
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  requestId?: string;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface DesignGateAssessment {
  status: 'blocked' | 'waiting' | 'approved';
  reason: string;
  evidenceDigests: `sha256:${string}`[];
  validation?: SpecificationValidation;
  snapshot?: PlanningSnapshot;
  approval?: SpecificationApprovalState;
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

  status(changeId: string): Promise<SpecificationApprovalState | null> {
    return this.store.load(changeId);
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
    const { change, validation, schema, current } = collected;
    const evidenceDigests = [schema.digest, change.changeDigest, validation.validationDigest];
    if (!change.planningComplete) {
      return {
        status: 'blocked',
        reason: 'Specification planning is incomplete',
        evidenceDigests,
        validation,
      };
    }
    if (!validation.strict || !validation.valid) {
      return {
        status: 'blocked',
        reason: 'Specification planning requires successful strict validation',
        evidenceDigests,
        validation,
      };
    }
    let snapshot: PlanningSnapshot;
    try {
      snapshot = createPlanningSnapshot({
        change,
        validation,
        schema,
        changeBranch: input.changeBranch,
        compositionDigest: input.compositionDigest,
        projectConfigDigest: input.projectConfigDigest,
      });
    } catch (error) {
      return {
        status: 'blocked',
        reason: error instanceof Error ? error.message : 'Specification planning manifest failed',
        evidenceDigests,
        validation,
      };
    }
    const next = requestSpecificationApproval({
      current,
      snapshot,
      timestamp: (input.now ?? (() => new Date()))().toISOString(),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    if (current?.stateVersion !== next.stateVersion) {
      await this.store.commit(next, current?.stateVersion ?? null);
    }
    if (
      next.status === 'approved' &&
      next.decision?.decision === 'approve' &&
      next.decision.snapshotDigest === snapshot.digest
    ) {
      return {
        status: 'approved',
        reason: 'Specification planning is strictly valid and has a trusted Human Decision',
        evidenceDigests: [...evidenceDigests, snapshot.digest],
        validation,
        snapshot,
        approval: next,
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
      };
    }
    return {
      status: 'waiting',
      reason: 'Specification planning is waiting for a trusted Human Decision',
      evidenceDigests: [...evidenceDigests, snapshot.digest],
      validation,
      snapshot,
      approval: next,
    };
  }

  private async collect(input: PrepareSpecificationApprovalInput) {
    const [schema, change, validation, current] = await Promise.all([
      this.ctx.specification.planningInstructions(input.changeId, input.signal),
      this.ctx.specification.inspect(input.changeId, input.signal),
      this.ctx.specification.validate(input.changeId, {
        strict: true,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      this.store.load(input.changeId),
    ]);
    return { schema, change, validation, current };
  }

  async decide(input: {
    changeId: string;
    response: SpecificationApprovalDecisionResponse;
    actor: SpecificationApprovalActor;
    now?: () => Date;
  }): Promise<SpecificationApprovalState> {
    const current = await this.store.load(input.changeId);
    if (!current) throw new Error(`Specification approval does not exist: ${input.changeId}`);
    const next = recordSpecificationApprovalDecision({
      state: current,
      response: input.response,
      actor: input.actor,
      timestamp: (input.now ?? (() => new Date()))().toISOString(),
    });
    await this.store.commit(next, current.stateVersion);
    return next;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    specificationPlanning: SpecificationPlanning;
  }
}
