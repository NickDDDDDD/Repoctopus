import { createHash } from 'node:crypto';
import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  PostMergeCheckoutManifest,
  PostMergeCheckoutPort,
  PostMergeRepositorySource,
} from '../domains/post-merge/checkout.js';
import { postMergeTriggerFacts } from '../domains/post-merge/run.js';
import type { EvidenceGateProjection } from '../domains/evidence/types.js';
import { GitPostMergeCheckout } from '../platform/git/post-merge-checkout.js';
import { withRecoverableFileLock } from '../platform/runtime/recoverable-file-lock.js';

export interface PostMergeActionsConfig {
  temporaryRoot: string;
  checkout?: PostMergeCheckoutPort;
}

export interface PostMergeVerificationResult {
  runId: string;
  checkout: PostMergeCheckoutManifest;
  attemptId: string;
  gate: EvidenceGateProjection;
  status: 'succeeded' | 'failed';
}

function identity(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export class PostMergeActions extends Service {
  static inject = ['evidenceCoordinator', 'workflowRuns'];

  private readonly temporaryRoot: string;
  private readonly checkout: PostMergeCheckoutPort;

  constructor(context: Context, config: PostMergeActionsConfig) {
    super(context, 'postMergeActions');
    if (!config?.temporaryRoot?.trim()) throw new Error('Post-merge temporary root is required');
    this.temporaryRoot = path.resolve(config.temporaryRoot);
    this.checkout = config.checkout ?? new GitPostMergeCheckout();
  }

  async verifyMergedCode(
    input: { runId: string; profileId: string; sources: PostMergeRepositorySource[] },
    signal?: AbortSignal,
  ): Promise<PostMergeVerificationResult> {
    const lock = path.join(
      this.temporaryRoot,
      '.locks',
      `${identity('post-merge-verification-lock/v1', input.runId)}.lock`,
    );
    return withRecoverableFileLock(lock, () => this.verifyMergedCodeLocked(input, signal));
  }

  private async verifyMergedCodeLocked(
    input: { runId: string; profileId: string; sources: PostMergeRepositorySource[] },
    signal?: AbortSignal,
  ): Promise<PostMergeVerificationResult> {
    let status = await this.ctx.workflowRuns.status(input.runId, signal);
    if (status.state.workflowName !== 'post-merge') {
      throw new Error(`Run is not a Post-merge workflow: ${input.runId}`);
    }
    if (status.state.currentStep !== 'checkout' && status.state.currentStep !== 'evidence') {
      throw new Error(`Post-merge Run is not awaiting checkout or Evidence: ${input.runId}`);
    }
    const facts = postMergeTriggerFacts(status.state.trigger);

    if (status.state.currentStep === 'checkout' && status.state.pendingActionId === null) {
      status = (await this.ctx.workflowRuns.next(input.runId, new Set(), signal)).value;
    }
    const checkoutAction =
      status.state.currentStep === 'checkout' && status.state.pendingActionId
        ? status.nextAction
        : null;
    if (
      status.state.currentStep === 'checkout' &&
      checkoutAction?.ref !== 'post-merge.checkout-exact-commits'
    ) {
      throw new Error('Post-merge checkout action is not pending');
    }

    let manifest: PostMergeCheckoutManifest;
    try {
      manifest = await this.checkout.checkout({
        runId: input.runId,
        mergeFactsDigest: status.state.trigger!.identityDigest,
        temporaryRoot: this.temporaryRoot,
        repositories: facts.repositories,
        sources: input.sources,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (checkoutAction) {
        await this.ctx.workflowRuns.record(
          {
            runId: input.runId,
            actionId: checkoutAction.id,
            status: 'failed',
            summary: 'post-merge-checkout-failed',
            eventId: identity(input.runId, checkoutAction.id, 'checkout-failed'),
          },
          signal,
        );
      }
      throw error;
    }

    try {
      await this.checkout.verify(manifest, signal);
      if (checkoutAction) {
        status = (
          await this.ctx.workflowRuns.record(
            {
              runId: input.runId,
              actionId: checkoutAction.id,
              status: 'succeeded',
              summary: `post-merge-checkout:${manifest.digest}`,
              eventId: identity(input.runId, checkoutAction.id, manifest.digest),
            },
            signal,
          )
        ).value;
      }
      if (status.state.currentStep !== 'evidence') {
        throw new Error('Post-merge Evidence step did not follow checkout');
      }
      if (status.state.pendingActionId === null) {
        status = (await this.ctx.workflowRuns.next(input.runId, new Set(), signal)).value;
      }
      const evidenceAction = status.nextAction;
      if (
        !evidenceAction ||
        evidenceAction.ref !== 'post-merge.collect-evidence' ||
        evidenceAction.evidenceProfile !== input.profileId
      ) {
        throw new Error(`Post-merge Evidence profile is not active: ${input.profileId}`);
      }
      const retry = status.state.retries[evidenceAction.id] ?? 0;
      const attemptId = identity(
        'post-merge-evidence/v1',
        input.runId,
        evidenceAction.id,
        String(retry),
        manifest.digest,
      );
      let result;
      try {
        result = await this.ctx.evidenceCoordinator.runForRepositories(
          input.profileId,
          manifest.repositories.map((repository) => ({
            repositoryId: repository.repositoryId,
            root: repository.path,
            head: repository.mergeCommit,
          })),
          attemptId,
          input.runId,
          signal,
        );
      } catch (error) {
        await this.ctx.workflowRuns.record(
          {
            runId: input.runId,
            actionId: evidenceAction.id,
            status: 'failed',
            summary: 'post-merge-evidence-execution-failed',
            eventId: identity(input.runId, evidenceAction.id, attemptId, 'execution-failed'),
          },
          signal,
        );
        throw error;
      }
      const succeeded = result.gate.status === 'satisfied';
      await this.ctx.workflowRuns.record(
        {
          runId: input.runId,
          actionId: evidenceAction.id,
          status: succeeded ? 'succeeded' : 'failed',
          summary: succeeded ? 'post-merge-evidence-satisfied' : 'post-merge-evidence-blocked',
          eventId: identity(input.runId, evidenceAction.id, attemptId, result.gate.status),
          evidenceAttemptId: attemptId,
        },
        signal,
      );
      return {
        runId: input.runId,
        checkout: manifest,
        attemptId,
        gate: result.gate,
        status: succeeded ? 'succeeded' : 'failed',
      };
    } finally {
      await this.checkout.cleanup(manifest);
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    postMergeActions: PostMergeActions;
  }
}
