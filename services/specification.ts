import { createHash } from 'node:crypto';

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
  SpecificationFollowUpChange,
  SpecificationFollowUpChangeInput,
  SpecificationPhaseContext,
} from '../domains/specification/types.js';
import { createSpecificationPlanningManifest } from '../domains/specification/planning-manifest.js';
import { createSpecificationPlanningGuidance } from '../domains/specification/planning-guidance.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';

export type SpecificationRoot = PlanningSpecificationRoot;

export function specificationPhaseArtifacts(
  phase: SpecificationPhaseContext['phase'],
  artifacts: SpecificationPlanningContext['artifacts'],
): SpecificationPlanningContext['artifacts'] {
  const applicable: Record<SpecificationPhaseContext['phase'], readonly string[]> = {
    open: ['proposal'],
    design: ['proposal', 'specs', 'design', 'tasks'],
    build: ['tasks'],
    verify: ['specs', 'tasks'],
    archive: ['proposal', 'specs', 'design', 'tasks'],
  };
  const selected = artifacts.filter((artifact) => applicable[phase].includes(artifact.id));
  if (selected.length !== applicable[phase].length) {
    throw new Error(`Specification Provider phase protocol is incomplete for ${phase}`);
  }
  return selected;
}

export function createSpecificationPhaseContext(input: {
  phase: SpecificationPhaseContext['phase'];
  provider: SpecificationProviderIdentity;
  artifacts: SpecificationPlanningContext['artifacts'];
}): SpecificationPhaseContext {
  const allowedOperations: SpecificationPhaseContext['allowedOperations'] =
    input.phase === 'open'
      ? ['inspect-change', 'write-planning-artifact']
      : input.phase === 'design'
        ? ['inspect-change', 'write-planning-artifact', 'validate-strict']
        : input.phase === 'build'
          ? ['inspect-change', 'read-tasks', 'complete-task-from-receipt']
          : input.phase === 'verify'
            ? ['inspect-change', 'validate-strict', 'read-tasks']
            : ['inspect-change', 'validate-strict', 'prepare-closure', 'close-change'];
  const stable = {
    schemaVersion: 1 as const,
    phase: input.phase,
    provider: structuredClone(input.provider),
    instruction: `Use only the ${input.provider.id} Specification Provider operations allowed for ${input.phase}; Runtime validators own completion.`,
    allowedOperations,
    artifacts: structuredClone(input.artifacts),
  };
  return {
    ...stable,
    digest: `sha256:${createHash('sha256').update(canonicalJson(stable)).digest('hex')}`,
  };
}

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
  phaseContext(
    phase: SpecificationPhaseContext['phase'],
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPhaseContext>;
  planningManifest(changeId: string, signal?: AbortSignal): Promise<SpecificationPlanningManifest>;
  planningGuidance(changeId: string, signal?: AbortSignal): Promise<SpecificationPlanningGuidance>;
  tasks(changeId: string, signal?: AbortSignal): Promise<SpecificationTaskSet>;
  completeTask(input: CompleteSpecificationTaskInput): Promise<CompleteSpecificationTaskResult>;
  inspect(changeId: string, signal?: AbortSignal): Promise<SpecificationChange>;
  validate(
    changeId: string,
    options?: { strict?: boolean; signal?: AbortSignal },
  ): Promise<SpecificationValidation>;
  prepareClosure(input: PrepareSpecificationClosureInput): Promise<SpecificationClosurePlan>;
  close(plan: SpecificationClosurePlan, signal?: AbortSignal): Promise<SpecificationClosureResult>;
  openFollowUp(input: SpecificationFollowUpChangeInput): Promise<SpecificationFollowUpChange>;
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
  async phaseContext(
    phase: SpecificationPhaseContext['phase'],
    changeId: string,
    signal?: AbortSignal,
  ): Promise<SpecificationPhaseContext> {
    const artifacts = specificationPhaseArtifacts(
      phase,
      (await this.planningContext(changeId, signal)).artifacts,
    );
    return createSpecificationPhaseContext({ phase, provider: this.identity(), artifacts });
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
    return createSpecificationPlanningGuidance(await this.planningInstructions(changeId, signal));
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
  openFollowUp(input: SpecificationFollowUpChangeInput): Promise<SpecificationFollowUpChange> {
    return Promise.reject(
      new Error(
        `Specification provider ${this.identity().id} cannot open follow-up ${input.changeId}`,
      ),
    );
  }

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
