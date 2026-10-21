import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  PostMergeCheckoutManifest,
  PostMergeCheckoutPort,
  PostMergeRepositorySource,
  PostMergeTargetMergeIntent,
  PostMergeTargetMergeReceipt,
} from '../domains/post-merge/checkout.js';
import {
  assertPostMergeTargetMergeIntent,
  assertPostMergeTargetMergeReceipt,
} from '../domains/post-merge/checkout.js';
import {
  assertPostMergeClosureAudit,
  assertSafeClosurePlan,
  auditPostMergeClosure,
  type PostMergeClosureAudit,
  type PostMergeWorkspaceBaseline,
  type PostMergeWorkspacePort,
} from '../domains/post-merge/closure.js';
import { postMergeTriggerFacts } from '../domains/post-merge/run.js';
import {
  assertPostMergePublicationReceipt,
  assertPostMergePublicationRequest,
  postMergePublicationPolicyFindings,
  type PostMergePublicationPolicy,
  type PostMergePublicationReceipt,
  type PostMergePublicationRequest,
} from '../domains/delivery/post-merge.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import type { EvidenceGateProjection } from '../domains/evidence/types.js';
import type {
  SpecificationClosurePlan,
  SpecificationClosureResult,
} from '../domains/specification/types.js';
import { atomicWriteJson } from '../platform/filesystem/atomic-write.js';
import { GitPostMergeCheckout } from '../platform/git/post-merge-checkout.js';
import { GitPostMergeWorkspace } from '../platform/git/post-merge-workspace.js';
import { withRecoverableFileLock } from '../platform/runtime/recoverable-file-lock.js';

export interface PostMergeActionsConfig {
  temporaryRoot: string;
  workspaceRoot?: string;
  verificationPathPrefixes?: string[];
  checkout?: PostMergeCheckoutPort;
  workspace?: PostMergeWorkspacePort;
  publicationPolicy?: PostMergePublicationPolicy | (() => PostMergePublicationPolicy);
}

export interface PostMergeVerificationResult {
  runId: string;
  checkout: PostMergeCheckoutManifest;
  attemptId: string;
  gate: EvidenceGateProjection;
  status: 'succeeded' | 'failed';
}

export interface PostMergeSpecificationClosureResult {
  runId: string;
  plan: SpecificationClosurePlan;
  result: SpecificationClosureResult;
}

export interface PostMergePathAuditResult {
  runId: string;
  audit: PostMergeClosureAudit;
}

export interface PostMergePublicationResult {
  runId: string;
  receipt: PostMergePublicationReceipt;
}

interface PostMergeClosureJournal {
  schemaVersion: 1;
  runId: string;
  targetMerge?: {
    intent: PostMergeTargetMergeIntent;
    receipt?: PostMergeTargetMergeReceipt;
  };
  baseline: PostMergeWorkspaceBaseline;
  plan: SpecificationClosurePlan;
  result?: SpecificationClosureResult;
  audit?: PostMergeClosureAudit;
  publication?: {
    request: PostMergePublicationRequest;
    receipt?: PostMergePublicationReceipt;
  };
}

type PostMergeRunStatus = Awaited<ReturnType<Context['workflowRuns']['status']>>;

function identity(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export class PostMergeActions extends Service {
  static inject = ['delivery', 'evidenceCoordinator', 'specification', 'workflowRuns'];

  private readonly temporaryRoot: string;
  private readonly workspaceRoot: string;
  private readonly verificationPathPrefixes: string[];
  private readonly checkout: PostMergeCheckoutPort;
  private readonly workspace: PostMergeWorkspacePort;
  private readonly publicationPolicy: (() => PostMergePublicationPolicy) | undefined;

  constructor(context: Context, config: PostMergeActionsConfig) {
    super(context, 'postMergeActions');
    if (!config?.temporaryRoot?.trim()) throw new Error('Post-merge temporary root is required');
    this.temporaryRoot = path.resolve(config.temporaryRoot);
    this.workspaceRoot = path.resolve(config.workspaceRoot ?? process.cwd());
    this.verificationPathPrefixes = [...(config.verificationPathPrefixes ?? [])];
    this.checkout = config.checkout ?? new GitPostMergeCheckout();
    this.workspace = config.workspace ?? new GitPostMergeWorkspace();
    if (typeof config.publicationPolicy === 'function') {
      this.publicationPolicy = config.publicationPolicy;
    } else if (config.publicationPolicy) {
      const policy = structuredClone(config.publicationPolicy);
      if (postMergePublicationPolicyFindings(policy).length > 0) {
        throw new Error('Post-merge publication policy is invalid');
      }
      this.publicationPolicy = () => structuredClone(policy);
    }
  }

  private workspaceLock(): string {
    return path.join(
      this.temporaryRoot,
      '.locks',
      `${identity('post-merge-workspace-lock/v1', this.workspaceRoot.toLowerCase())}.lock`,
    );
  }

  private closureJournalFile(runId: string): string {
    return path.join(
      this.workspaceRoot,
      '.repoctopus',
      'post-merge',
      `${identity('post-merge-closure-journal/v1', runId)}.json`,
    );
  }

  private async loadClosureJournal(runId: string): Promise<PostMergeClosureJournal | null> {
    try {
      const value = JSON.parse(
        await readFile(this.closureJournalFile(runId), 'utf8'),
      ) as Partial<PostMergeClosureJournal>;
      if (
        value.schemaVersion !== 1 ||
        value.runId !== runId ||
        value.plan?.kind !== 'SpecificationClosurePlan' ||
        value.baseline?.schemaVersion !== 1 ||
        (value.targetMerge && value.targetMerge.intent?.schemaVersion !== 1) ||
        (value.targetMerge?.receipt && value.targetMerge.receipt.schemaVersion !== 1) ||
        (value.result && value.result.kind !== 'SpecificationClosureResult') ||
        (value.audit && value.audit.schemaVersion !== 1) ||
        (value.publication && value.publication.request?.schemaVersion !== 1) ||
        (value.publication?.receipt && value.publication.receipt.schemaVersion !== 1)
      ) {
        throw new Error(`Post-merge closure Journal is invalid for Run ${runId}`);
      }
      return value as PostMergeClosureJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private saveClosureJournal(journal: PostMergeClosureJournal): Promise<void> {
    return atomicWriteJson(this.closureJournalFile(journal.runId), journal, {
      containedRoot: this.workspaceRoot,
    });
  }

  private assertClosureJournalBinding(
    runId: string,
    journal: PostMergeClosureJournal,
    status: PostMergeRunStatus,
  ): void {
    assertSafeClosurePlan(journal.plan);
    if (journal.targetMerge) {
      assertPostMergeTargetMergeIntent(journal.targetMerge.intent);
      if (journal.targetMerge.receipt) {
        assertPostMergeTargetMergeReceipt(journal.targetMerge.receipt, journal.targetMerge.intent);
      }
    }
    const facts = postMergeTriggerFacts(status.state.trigger);
    const specification = status.state.specificationUsageSnapshot;
    if (
      journal.plan.changeId !== facts.changeId ||
      journal.plan.mergeFactsDigest !== status.state.trigger?.identityDigest ||
      journal.baseline.digest !== journal.plan.targetBaselineDigest ||
      !specification ||
      specification.changeId !== journal.plan.changeId ||
      specification.provider.id !== journal.plan.provider.id ||
      specification.provider.version !== journal.plan.provider.version ||
      specification.provider.protocolVersion !== journal.plan.provider.protocolVersion ||
      specification.closurePlanDigest !== journal.plan.planDigest
    ) {
      throw new Error(`Post-merge closure Journal is not bound to Run ${runId}`);
    }
    if (
      journal.result &&
      (journal.result.changeId !== journal.plan.changeId ||
        journal.result.planDigest !== journal.plan.planDigest ||
        journal.result.provider.id !== journal.plan.provider.id ||
        journal.result.provider.version !== journal.plan.provider.version ||
        journal.result.provider.protocolVersion !== journal.plan.provider.protocolVersion)
    ) {
      throw new Error(`Post-merge closure result is not bound to Run ${runId}`);
    }
    if (journal.audit) {
      if (!journal.result) {
        throw new Error(`Post-merge closure audit has no result for Run ${runId}`);
      }
      assertPostMergeClosureAudit(journal.audit, {
        plan: journal.plan,
        result: journal.result,
        baseline: journal.baseline,
      });
    }
    if (journal.publication) {
      if (!journal.audit) {
        throw new Error(`Post-merge publication has no path audit for Run ${runId}`);
      }
      assertPostMergePublicationRequest(journal.publication.request);
      if (
        journal.publication.request.runId !== runId ||
        journal.publication.request.changeId !== journal.plan.changeId ||
        journal.publication.request.baseline.digest !== journal.baseline.digest ||
        journal.publication.request.audit.digest !== journal.audit.digest
      ) {
        throw new Error(`Post-merge publication request is not bound to Run ${runId}`);
      }
      if (journal.publication.receipt) {
        assertPostMergePublicationReceipt(journal.publication.receipt, journal.publication.request);
      }
    }
  }

  async closeSpecification(
    runId: string,
    signal?: AbortSignal,
  ): Promise<PostMergeSpecificationClosureResult> {
    return withRecoverableFileLock(this.workspaceLock(), () =>
      this.closeSpecificationLocked(runId, signal),
    );
  }

  private async closeSpecificationLocked(
    runId: string,
    signal?: AbortSignal,
  ): Promise<PostMergeSpecificationClosureResult> {
    let status = await this.ctx.workflowRuns.status(runId, signal);
    if (status.state.workflowName !== 'post-merge') {
      throw new Error(`Run is not a Post-merge workflow: ${runId}`);
    }
    let journal = await this.loadClosureJournal(runId);
    if (status.state.currentStep !== 'close-specification') {
      if (
        journal?.result &&
        (status.state.currentStep === 'audit-paths' || status.state.currentStep === 'publish')
      ) {
        this.assertClosureJournalBinding(runId, journal, status);
        return { runId, plan: journal.plan, result: journal.result };
      }
      throw new Error(`Post-merge Run is not awaiting Specification closure: ${runId}`);
    }
    if (status.state.pendingActionId === null) {
      status = (await this.ctx.workflowRuns.next(runId, new Set(), signal)).value;
    }
    const action = status.nextAction;
    if (!action || action.ref !== 'post-merge.close-specification') {
      throw new Error('Post-merge Specification closure action is not pending');
    }
    try {
      if (journal) this.assertClosureJournalBinding(runId, journal, status);
      if (!journal) {
        const facts = postMergeTriggerFacts(status.state.trigger);
        const validation = await this.ctx.specification.validate(facts.changeId, {
          strict: true,
          ...(signal ? { signal } : {}),
        });
        if (!validation.valid) {
          throw new Error(`Specification change is not valid: ${facts.changeId}`);
        }
        await this.ctx.workflowRuns.bindSpecification(runId, validation, signal);
        const baseline = await this.workspace.cleanBaseline(this.workspaceRoot);
        const plan = await this.ctx.specification.prepareClosure({
          changeId: facts.changeId,
          mergeFactsDigest: status.state.trigger!.identityDigest,
          targetBaselineDigest: baseline.digest,
          ...(signal ? { signal } : {}),
        });
        assertSafeClosurePlan(plan);
        await this.ctx.workflowRuns.bindSpecificationClosurePlan(runId, plan, signal);
        journal = { schemaVersion: 1, runId, baseline, plan };
        await this.saveClosureJournal(journal);
      }
      assertSafeClosurePlan(journal.plan);
      const result = journal.result ?? (await this.ctx.specification.close(journal.plan, signal));
      journal = { ...journal, result };
      await this.saveClosureJournal(journal);
      await this.ctx.workflowRuns.record(
        {
          runId,
          actionId: action.id,
          status: 'succeeded',
          summary: `post-merge-specification-closed:${result.closureId}`,
          eventId: identity(runId, action.id, result.closureId),
          correlationReceiptId: result.closureId,
        },
        signal,
      );
      return { runId, plan: journal.plan, result };
    } catch (error) {
      await this.ctx.workflowRuns.record(
        {
          runId,
          actionId: action.id,
          status: 'failed',
          summary: 'post-merge-specification-closure-failed',
          eventId: identity(runId, action.id, 'specification-closure-failed'),
        },
        signal,
      );
      throw error;
    }
  }

  async auditSpecificationClosure(
    runId: string,
    signal?: AbortSignal,
  ): Promise<PostMergePathAuditResult> {
    return withRecoverableFileLock(this.workspaceLock(), () =>
      this.auditSpecificationClosureLocked(runId, signal),
    );
  }

  private async auditSpecificationClosureLocked(
    runId: string,
    signal?: AbortSignal,
  ): Promise<PostMergePathAuditResult> {
    let status = await this.ctx.workflowRuns.status(runId, signal);
    const journal = await this.loadClosureJournal(runId);
    if (status.state.currentStep !== 'audit-paths') {
      if (journal?.audit && status.state.currentStep === 'publish') {
        this.assertClosureJournalBinding(runId, journal, status);
        return { runId, audit: journal.audit };
      }
      throw new Error(`Post-merge Run is not awaiting path audit: ${runId}`);
    }
    if (status.state.pendingActionId === null) {
      status = (await this.ctx.workflowRuns.next(runId, new Set(), signal)).value;
    }
    const action = status.nextAction;
    if (!action || action.ref !== 'post-merge.audit-paths') {
      throw new Error('Post-merge path audit action is not pending');
    }
    try {
      if (!journal?.result) {
        throw new Error(`Post-merge closure Journal has no result for Run ${runId}`);
      }
      this.assertClosureJournalBinding(runId, journal, status);
      const diff = await this.workspace.diff(journal.baseline);
      const audit = auditPostMergeClosure({
        plan: journal.plan,
        result: journal.result,
        diff,
        verificationPathPrefixes: this.verificationPathPrefixes,
      });
      await this.saveClosureJournal({ ...journal, audit });
      await this.ctx.workflowRuns.record(
        {
          runId,
          actionId: action.id,
          status: 'succeeded',
          summary: `post-merge-path-audit:${audit.digest}`,
          eventId: identity(runId, action.id, audit.digest),
          correlationReceiptId: audit.digest,
        },
        signal,
      );
      return { runId, audit };
    } catch (error) {
      await this.ctx.workflowRuns.record(
        {
          runId,
          actionId: action.id,
          status: 'failed',
          summary: 'post-merge-path-audit-failed',
          eventId: identity(runId, action.id, 'path-audit-failed'),
        },
        signal,
      );
      throw error;
    }
  }

  async publishChange(runId: string, signal?: AbortSignal): Promise<PostMergePublicationResult> {
    return withRecoverableFileLock(this.workspaceLock(), () =>
      this.publishChangeLocked(runId, signal),
    );
  }

  private async publishChangeLocked(
    runId: string,
    signal?: AbortSignal,
  ): Promise<PostMergePublicationResult> {
    let status = await this.ctx.workflowRuns.status(runId, signal);
    let journal = await this.loadClosureJournal(runId);
    if (journal?.publication?.receipt && status.state.currentStep !== 'publish') {
      this.assertClosureJournalBinding(runId, journal, status);
      return { runId, receipt: journal.publication.receipt };
    }
    if (status.state.currentStep !== 'publish') {
      throw new Error(`Post-merge Run is not awaiting Change MR publication: ${runId}`);
    }
    if (status.state.pendingActionId === null) {
      status = (await this.ctx.workflowRuns.next(runId, new Set(), signal)).value;
    }
    const action = status.nextAction;
    if (!action || action.ref !== 'post-merge.publish-change') {
      throw new Error('Post-merge Change MR publication action is not pending');
    }
    try {
      if (!journal?.result || !journal.audit) {
        throw new Error(`Post-merge closure audit is incomplete for Run ${runId}`);
      }
      this.assertClosureJournalBinding(runId, journal, status);
      if (!this.publicationPolicy) {
        throw new Error('Post-merge publication policy is not configured');
      }
      const publicationPolicy = this.publicationPolicy();
      if (postMergePublicationPolicyFindings(publicationPolicy).length > 0) {
        throw new Error('Post-merge publication policy is invalid');
      }
      if (
        journal.publication &&
        canonicalJson(journal.publication.request.policy) !== canonicalJson(publicationPolicy)
      ) {
        throw new Error('Post-merge publication policy drifted after intent persistence');
      }
      if (!journal.publication) {
        const freshAudit = auditPostMergeClosure({
          plan: journal.plan,
          result: journal.result,
          diff: await this.workspace.diff(journal.baseline),
          verificationPathPrefixes: this.verificationPathPrefixes,
        });
        if (freshAudit.digest !== journal.audit.digest) {
          throw new Error('Post-merge closure changed after its path audit');
        }
        const request: PostMergePublicationRequest = {
          schemaVersion: 1,
          runId,
          changeId: journal.plan.changeId,
          workspaceRoot: this.workspaceRoot,
          baseline: structuredClone(journal.baseline),
          audit: structuredClone(freshAudit),
          policy: structuredClone(publicationPolicy),
        };
        assertPostMergePublicationRequest(request);
        journal = { ...journal, publication: { request } };
        await this.saveClosureJournal(journal);
      }
      const publication = journal.publication;
      if (!publication) throw new Error('Post-merge publication intent was not persisted');
      const receipt =
        publication.receipt ??
        (await this.ctx.delivery.publishPostMerge(publication.request, signal));
      assertPostMergePublicationReceipt(receipt, publication.request);
      if (!publication.receipt) {
        journal = {
          ...journal,
          publication: { request: publication.request, receipt },
        };
        await this.saveClosureJournal(journal);
      }
      await this.ctx.workflowRuns.record(
        {
          runId,
          actionId: action.id,
          status: 'succeeded',
          summary: `post-merge-change-published:${receipt.digest}`,
          eventId: identity(runId, action.id, receipt.digest),
          correlationReceiptId: receipt.digest,
        },
        signal,
      );
      return { runId, receipt };
    } catch (error) {
      await this.ctx.workflowRuns.record(
        {
          runId,
          actionId: action.id,
          status: 'failed',
          summary: 'post-merge-change-publication-failed',
          eventId: identity(runId, action.id, 'change-publication-failed'),
        },
        signal,
      );
      throw error;
    }
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
              correlationReceiptId: manifest.digest,
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
