import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  SpecificationChange,
  SpecificationClosurePlan,
  SpecificationClosureResult,
  SpecificationProviderIdentity,
  SpecificationValidation,
} from '../domains/specification/types.js';

export interface PrepareSpecificationClosureInput {
  changeId: string;
  mergeFactsDigest: `sha256:${string}`;
  targetBaselineDigest: `sha256:${string}`;
  signal?: AbortSignal;
}

export interface SpecificationWorkspace {
  identity(): SpecificationProviderIdentity;
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
