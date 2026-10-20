import { Service, type Context } from '@deepseek-ai/cordis';

import { coordinatePostMerge } from '../domains/post-merge/coordinator.js';
import { postMergeRunOptions, type PostMergeRunInput } from '../domains/post-merge/run.js';
import type { DeliveryPolicy, MergeRequestReference } from '../domains/delivery/types.js';
import { validateDeliveryPolicy } from '../domains/delivery/validation.js';

export interface PostMergeCoordinatorConfig {
  policy: DeliveryPolicy;
}

export class PostMergeCoordinator extends Service {
  static inject = ['delivery', 'workflowRuns'];
  private readonly policy: DeliveryPolicy;

  constructor(context: Context, config: PostMergeCoordinatorConfig) {
    super(context, 'postMergeCoordinator');
    const findings = validateDeliveryPolicy(config?.policy);
    if (findings.length > 0) {
      throw new Error(
        `Invalid Post-merge Delivery policy: ${findings.map((item) => item.code).join(', ')}`,
      );
    }
    this.policy = structuredClone(config.policy);
  }

  async wake(reference: MergeRequestReference, signal?: AbortSignal) {
    const refresh = await this.ctx.delivery.refreshForMergeRequest(reference, this.policy, signal);
    return coordinatePostMerge(refresh);
  }

  startRun(input: PostMergeRunInput, signal?: AbortSignal) {
    return this.ctx.workflowRuns.startOrResume(postMergeRunOptions(input), signal);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    postMergeCoordinator: PostMergeCoordinator;
  }
}
