import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  SpecificationChange,
  CompleteSpecificationTaskInput,
  CompleteSpecificationTaskResult,
  SpecificationClosurePlan,
  SpecificationClosureResult,
  SpecificationProviderIdentity,
  SpecificationSchemaInstructions,
  SpecificationPlanningContext,
  SpecificationTaskSet,
  SpecificationPlanningManifest,
  SpecificationPlanningGuidance,
  PlanningSpecificationRoot,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { createSpecificationPlanningManifest } from '../domains/specification/planning-manifest.js';
import { createSpecificationPlanningGuidance } from '../domains/specification/planning-guidance.js';

export type SpecificationRoot = PlanningSpecificationRoot;

export interface PrepareSpecificationClosureInput {
  changeId: string;
  mergeFactsDigest: `sha256:${string}`;
  targetBaselineDigest: `sha256:${string}`;
  signal?: AbortSignal;
}

export interface SpecificationWorkspace {
  identity(): SpecificationProviderIdentity;
  root(): SpecificationRoot;
  verifyRoot(signal?: AbortSignal): Promise<SpecificationRoot>;
  planningInstructions(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationSchemaInstructions>;
  planningContext(changeId: string, signal?: AbortSignal): Promise<SpecificationPlanningContext>;
  planningManifest(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPlanningManifest>;
  planningGuidance(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPlanningGuidance>;
  tasks(changeId: string, signal?: AbortSignal): Promise<SpecificationTaskSet>;
  completeTask(input: CompleteSpecificationTaskInput): Promise<CompleteSpecificationTaskResult>;
  inspect(changeId: string, signal?: AbortSignal): Promise<SpecificationChange>;
  validate(
    changeId: string,
    options?: { strict?: boolean; signal?: AbortSignal },
  ): Promise<SpecificationValidation>;
  prepareClosure(input: PrepareSpecificationClosureInput): Promise<SpecificationClosurePlan>;
  close(plan: SpecificationClosurePlan, signal?: AbortSignal): Promise<SpecificationClosureResult>;
}

export abstract class Specification extends Service implements SpecificationWorkspace {
  constructor(context: Context) {
    super(context, 'specification');
  }

  abstract identity(): SpecificationProviderIdentity;
  root(): SpecificationRoot {
    throw new Error(`Specification provider ${this.identity().id} has no configured root`);
  }
  verifyRoot(signal?: AbortSignal): Promise<SpecificationRoot> {
    void signal;
    return Promise.reject(
      new Error(`Specification provider ${this.identity().id} cannot verify its root`),
    );
  }
  planningInstructions(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationSchemaInstructions> {
    void changeId;
    void signal;
    return Promise.reject(
      new Error(`Specification provider ${this.identity().id} has no planning instructions`),
    );
  }
  planningContext(changeId: string, signal?: AbortSignal): Promise<SpecificationPlanningContext> {
    void changeId;
    void signal;
    return Promise.reject(
      new Error(`Specification provider ${this.identity().id} has no planning context`),
    );
  }
  tasks(changeId: string, signal?: AbortSignal): Promise<SpecificationTaskSet> {
    void changeId;
    void signal;
    return Promise.reject(
      new Error(`Specification provider ${this.identity().id} cannot read planning tasks`),
    );
  }
  completeTask(input: CompleteSpecificationTaskInput): Promise<CompleteSpecificationTaskResult> {
    void input;
    return Promise.reject(
      new Error(`Specification provider ${this.identity().id} cannot project Task completion`),
    );
  }
  async planningManifest(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPlanningManifest> {
    const [change, specificationRoot, schema] = await Promise.all([
      this.inspect(changeId, signal),
      this.verifyRoot(signal),
      this.planningInstructions(changeId, signal),
    ]);
    return createSpecificationPlanningManifest({ change, specificationRoot, schema });
  }
  async planningGuidance(
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPlanningGuidance> {
    return createSpecificationPlanningGuidance(
      await this.planningInstructions(changeId, signal),
    );
  }
  abstract inspect(changeId: string, signal?: AbortSignal): Promise<SpecificationChange>;
  abstract validate(
    changeId: string,
    options?: { strict?: boolean; signal?: AbortSignal },
  ): Promise<SpecificationValidation>;
  abstract prepareClosure(
    input: PrepareSpecificationClosureInput,
  ): Promise<SpecificationClosurePlan>;
  abstract close(
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<SpecificationClosureResult>;

  atWorkspace(workspaceRoot: string): SpecificationWorkspace {
    throw new Error(
      `Specification provider ${this.identity().id} cannot bind workspace: ${workspaceRoot}`,
    );
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    specification: Specification;
  }
}
