import { Service, type Context } from '@deepseek-ai/cordis';

import { coordinatePostMerge } from '../domains/post-merge/coordinator.js';
import type { PostMergeProjectSource } from '../domains/post-merge/run.js';
import type { DeliveryPolicy, MergeRequestReference } from '../domains/delivery/types.js';
import { validateDeliveryPolicy } from '../domains/delivery/validation.js';

export interface PostMergeCoordinatorConfig {
  policy: DeliveryPolicy;
  execution?: {
    projectId: string;
    workspaceRoot: string;
    workflowSource: string;
    evidenceProfile: string;
    repositories: PostMergeProjectSource[];
  };
}

export type PostMergeExecutionResult =
  | Awaited<ReturnType<typeof coordinatePostMerge>>
  | {
      status: 'migration_required';
      diagnostic: 'change-lifecycle-run-required';
      changeId: string;
      replacementCommand: 'run.archive.refresh';
    };

export type PostMergeReconciliationItem =
  | (PostMergeExecutionResult & { candidateChangeId: string })
  | {
      status: 'failed';
      diagnostic: 'post-merge-reconciliation-failed';
      candidateChangeId: string;
    };

export interface PostMergeReconciliationResult {
  checked: number;
  completed: number;
  waiting: number;
  blocked: number;
  failed: number;
  items: PostMergeReconciliationItem[];
}

export class PostMergeCoordinator extends Service {
  static inject = ['delivery'];
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

  async observe(
    reference: MergeRequestReference,
    signal?: AbortSignal,
  ): Promise<PostMergeExecutionResult> {
    const coordination = await this.wake(reference, signal);
    if (coordination.status !== 'ready') return coordination;
    return {
      status: 'migration_required',
      diagnostic: 'change-lifecycle-run-required',
      changeId: coordination.changeId,
      replacementCommand: 'run.archive.refresh',
    };
  }

  /** @deprecated Compatibility fence. This observes facts but never starts or advances a workflow. */
  execute(reference: MergeRequestReference, signal?: AbortSignal): Promise<PostMergeExecutionResult> {
    return this.observe(reference, signal);
  }

  async reconcile(signal?: AbortSignal): Promise<PostMergeReconciliationResult> {
    const candidates = await this.ctx.delivery.reconciliationCandidates(signal);
    const items: PostMergeReconciliationItem[] = [];
    for (const candidate of candidates) {
      try {
        items.push({
          ...(await this.observe(candidate.reference, signal)),
          candidateChangeId: candidate.changeId,
        });
      } catch {
        items.push({
          status: 'failed',
          diagnostic: 'post-merge-reconciliation-failed',
          candidateChangeId: candidate.changeId,
        });
      }
    }
    return {
      checked: candidates.length,
      completed: 0,
      waiting: items.filter((item) => item.status === 'waiting').length,
      blocked: items.filter(
        (item) =>
          item.status === 'blocked' ||
          item.status === 'ambiguous' ||
          item.status === 'ignored' ||
          item.status === 'migration_required',
      ).length,
      failed: items.filter((item) => item.status === 'failed').length,
      items,
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    postMergeCoordinator: PostMergeCoordinator;
  }
}
