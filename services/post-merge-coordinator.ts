import { Service, type Context } from '@deepseek-ai/cordis';

import { coordinatePostMerge } from '../domains/post-merge/coordinator.js';
import {
  postMergeProjectSnapshot,
  postMergeRunOptions,
  type PostMergeProjectSource,
  type PostMergeRunInput,
} from '../domains/post-merge/run.js';
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
      status: 'executed';
      diagnostic: 'post-merge-completed' | 'post-merge-evidence-blocked';
      changeId: string;
      runId: string;
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
  static inject = ['delivery', 'postMergeActions', 'workflowRuns', 'workflowSource'];
  private readonly policy: DeliveryPolicy;
  private readonly execution: PostMergeCoordinatorConfig['execution'];

  constructor(context: Context, config: PostMergeCoordinatorConfig) {
    super(context, 'postMergeCoordinator');
    const findings = validateDeliveryPolicy(config?.policy);
    if (findings.length > 0) {
      throw new Error(
        `Invalid Post-merge Delivery policy: ${findings.map((item) => item.code).join(', ')}`,
      );
    }
    this.policy = structuredClone(config.policy);
    this.execution = config.execution ? structuredClone(config.execution) : undefined;
  }

  async wake(reference: MergeRequestReference, signal?: AbortSignal) {
    const refresh = await this.ctx.delivery.refreshForMergeRequest(reference, this.policy, signal);
    return coordinatePostMerge(refresh);
  }

  startRun(input: PostMergeRunInput, signal?: AbortSignal) {
    return this.ctx.workflowRuns.startOrResume(postMergeRunOptions(input), signal);
  }

  async execute(
    reference: MergeRequestReference,
    signal?: AbortSignal,
  ): Promise<PostMergeExecutionResult> {
    const coordination = await this.wake(reference, signal);
    if (coordination.status !== 'ready') return coordination;
    if (!this.execution) throw new Error('Post-merge execution configuration is missing');

    const workflow = await this.ctx.workflowSource.load(this.execution.workflowSource);
    const projectSnapshot = postMergeProjectSnapshot({
      coordination,
      projectId: this.execution.projectId,
      root: this.execution.workspaceRoot,
      sources: this.execution.repositories,
      capturedAt: new Date().toISOString(),
    });
    const started = await this.startRun(
      {
        coordination,
        workflow,
        projectSnapshot,
        workflowSource: this.execution.workflowSource,
      },
      signal,
    );
    const runId = started.value.state.runId;
    let status = started.value;

    if (status.state.status === 'completed') {
      return {
        status: 'executed',
        diagnostic: 'post-merge-completed',
        changeId: coordination.changeId,
        runId,
      };
    }
    if (status.state.currentStep === 'checkout' || status.state.currentStep === 'evidence') {
      const verification = await this.ctx.postMergeActions.verifyMergedCode(
        {
          runId,
          profileId: this.execution.evidenceProfile,
          sources: this.execution.repositories,
        },
        signal,
      );
      if (verification.status !== 'succeeded') {
        return {
          status: 'executed',
          diagnostic: 'post-merge-evidence-blocked',
          changeId: coordination.changeId,
          runId,
        };
      }
      status = await this.ctx.workflowRuns.status(runId, signal);
    }
    if (status.state.currentStep === 'close-specification') {
      await this.ctx.postMergeActions.closeSpecification(runId, signal);
      status = await this.ctx.workflowRuns.status(runId, signal);
    }
    if (status.state.currentStep === 'audit-paths') {
      await this.ctx.postMergeActions.auditSpecificationClosure(runId, signal);
      status = await this.ctx.workflowRuns.status(runId, signal);
    }
    if (status.state.currentStep === 'publish') {
      await this.ctx.postMergeActions.publishCoordination(runId, signal);
      status = await this.ctx.workflowRuns.status(runId, signal);
    }
    if (status.state.status !== 'completed') {
      throw new Error(`Post-merge Run stopped before completion: ${runId}`);
    }
    return {
      status: 'executed',
      diagnostic: 'post-merge-completed',
      changeId: coordination.changeId,
      runId,
    };
  }

  async reconcile(signal?: AbortSignal): Promise<PostMergeReconciliationResult> {
    const candidates = await this.ctx.delivery.reconciliationCandidates(signal);
    const items: PostMergeReconciliationItem[] = [];
    for (const candidate of candidates) {
      try {
        items.push({
          ...(await this.execute(candidate.reference, signal)),
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
      completed: items.filter((item) => item.status === 'executed').length,
      waiting: items.filter((item) => item.status === 'waiting').length,
      blocked: items.filter(
        (item) =>
          item.status === 'blocked' || item.status === 'ambiguous' || item.status === 'ignored',
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
