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
    const [change, validation, current] = await Promise.all([
      this.ctx.specification.inspect(input.changeId, input.signal),
      this.ctx.specification.validate(input.changeId, {
        strict: true,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      this.store.load(input.changeId),
    ]);
    const snapshot = createPlanningSnapshot({
      change,
      validation,
      changeBranch: input.changeBranch,
      compositionDigest: input.compositionDigest,
      projectConfigDigest: input.projectConfigDigest,
    });
    const next = requestSpecificationApproval({
      current,
      snapshot,
      timestamp: (input.now ?? (() => new Date()))().toISOString(),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    if (current?.stateVersion === next.stateVersion) return next;
    await this.store.commit(next, current?.stateVersion ?? null);
    return next;
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
