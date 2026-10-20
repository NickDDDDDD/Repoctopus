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

export abstract class Specification extends Service {
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
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    specification: Specification;
  }
}
