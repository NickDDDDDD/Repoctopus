import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ProjectSnapshot, RepositorySnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  createDeliverySnapshot,
  deliveryIntentDigest,
  deliveryPolicyDigest,
  sha256Digest,
} from './snapshot.js';
import { matchActiveDeliveryMergeRequest, recordBusinessMergeRequest } from './merge-requests.js';
import {
  initialDeliveryState,
  invalidateApproval,
  recordHumanDecision,
  requestDeliveryApproval,
} from './state.js';
import type {
  DeliveryEvent,
  DeliveryGitPort,
  DeliveryEvidencePort,
  DeliveryStorePort,
  DeliveryTelemetryPort,
  MergeRequestInput,
  MergeRequestPort,
} from './ports.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryState,
  HumanDecisionResponse,
  MergeEvidence,
  MergeRequestIdentity,
  MergeRequestReference,
  MergeRequestStatus,
  TrustedActor,
} from './types.js';
import { validateDeliveryIntent, validateDeliveryPolicy } from './validation.js';
import {
  assertPostMergePublicationRequest,
  createPostMergePublicationReceipt,
  type PostMergeDeliveryGitPort,
  type PostMergePublicationReceipt,
  type PostMergePublicationRequest,
} from './post-merge.js';

function selectedRepositories(
  project: ProjectSnapshot,
  intent: DeliveryIntent,
): Map<string, RepositorySnapshot> {
  const available = new Map(project.repositories.map((repository) => [repository.id, repository]));
  const selected = new Map<string, RepositorySnapshot>();
  for (const item of intent.repositories) {
    const repository = available.get(item.repositoryId);
    if (!repository) throw new Error(`Selected repository is missing: ${item.repositoryId}`);
    selected.set(item.repositoryId, repository);
  }
  return selected;
}

function event(
  state: DeliveryState,
  type: DeliveryEvent['type'],
  timestamp: string,
  data: Record<string, unknown>,
): DeliveryEvent {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    changeId: state.changeId,
    stateVersion: state.stateVersion,
    timestamp,
    type,
    data,
  };
}

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => values[key] ?? '');
}

export class DeliveryService {
  constructor(
    private readonly store: DeliveryStorePort,
    private readonly git: DeliveryGitPort,
    private readonly mergeRequests: MergeRequestPort,
    private readonly evidence: DeliveryEvidencePort,
    private readonly clock: () => Date = () => new Date(),
    private readonly telemetry?: DeliveryTelemetryPort,
    private readonly compositionDigest: string = `sha256:${'0'.repeat(64)}`,
    private readonly postMergeGit?: PostMergeDeliveryGitPort,
  ) {}

  async checkpoint(project: ProjectSnapshot, intent: DeliveryIntent, policy: DeliveryPolicy) {
    this.validate(intent, policy);
    const repositories = selectedRepositories(project, intent);
    const results = [];
    for (const selected of [...intent.repositories].sort((a, b) =>
      a.repositoryId.localeCompare(b.repositoryId),
    )) {
      results.push(
        await this.git.checkpoint(repositories.get(selected.repositoryId)!, selected, policy),
      );
    }
    return results;
  }

  async prepare(options: {
    project: ProjectSnapshot;
    intent: DeliveryIntent;
    policy: DeliveryPolicy;
    reportContents: string;
    evidenceBundleIds: string[];
  }): Promise<DeliveryState> {
    this.validate(options.intent, options.policy);
    await this.evidence.assertSatisfied(options.evidenceBundleIds, this.compositionDigest);
    const repositories = selectedRepositories(options.project, options.intent);
    const facts = [];
    for (const selected of options.intent.repositories)
      facts.push(
        await this.git.inspect(repositories.get(selected.repositoryId)!, selected, options.policy),
      );
    const timestamp = this.clock().toISOString();
    const snapshot = createDeliverySnapshot({
      compositionDigest: this.compositionDigest,
      intent: options.intent,
      policy: options.policy,
      reportContents: options.reportContents,
      evidenceBundleIds: options.evidenceBundleIds,
      repositories: facts,
      createdAt: timestamp,
    });
    const previous = await this.store.load(options.intent.changeId);
    const base = previous ?? initialDeliveryState(options.intent.changeId, timestamp);
    if (previous?.status === 'awaiting_approval') {
      if (previous.snapshot?.digest === snapshot.digest) return previous;
      if (
        previous.approval !== null ||
        previous.actionResults.some(
          (result) => result.status !== 'pending' || result.attempts !== 0,
        )
      ) {
        throw new Error('Pending approval cannot be superseded after a decision or action');
      }
    } else if (
      previous &&
      !['development', 'verification_required', 'rejected'].includes(previous.status)
    ) {
      throw new Error(`Delivery cannot be prepared from ${previous.status}`);
    }
    const next = requestDeliveryApproval(base, snapshot, timestamp);
    await this.commit(
      next,
      previous?.stateVersion ?? null,
      event(next, 'delivery.prepared', timestamp, {
        snapshotDigest: snapshot.digest,
        repositoryCount: snapshot.repositories.length,
        ...(previous?.status === 'awaiting_approval'
          ? {
              supersededRequestId: previous.decisionRequest?.requestId,
              previousSnapshotDigest: previous.snapshot?.digest,
            }
          : {}),
      }),
    );
    return next;
  }

  async decide(
    changeId: string,
    response: HumanDecisionResponse,
    actor: TrustedActor,
  ): Promise<DeliveryState> {
    const previous = await this.requireState(changeId);
    this.assertWritableComposition(previous);
    if (
      previous.approval?.requestId === response.requestId &&
      previous.approval.snapshotDigest === response.snapshotDigest &&
      previous.approval.decision === response.decision
    ) {
      return previous;
    }
    const timestamp = this.clock().toISOString();
    const next = recordHumanDecision(previous, response, actor, timestamp);
    await this.commit(
      next,
      previous.stateVersion,
      event(next, 'delivery.decided', timestamp, {
        decision: response.decision,
        snapshotDigest: response.snapshotDigest,
      }),
    );
    return next;
  }

  async publish(options: {
    project: ProjectSnapshot;
    intent: DeliveryIntent;
    policy: DeliveryPolicy;
    reportContents: string;
    evidenceBundleIds: string[];
  }): Promise<DeliveryState> {
    let state = await this.requireState(options.intent.changeId);
    this.assertWritableComposition(state);
    if (
      !state.snapshot ||
      !state.approval ||
      !['approved', 'partially_published', 'publishing'].includes(state.status)
    )
      throw new Error('Delivery does not have an effective approval');
    const repositories = selectedRepositories(options.project, options.intent);
    const currentFacts = [];
    for (const selected of options.intent.repositories)
      currentFacts.push(
        await this.git.inspect(repositories.get(selected.repositoryId)!, selected, options.policy),
      );
    const drift = this.approvalDrift(
      state,
      options.intent,
      options.policy,
      options.reportContents,
      options.evidenceBundleIds,
      currentFacts,
    );
    if (drift.length > 0) {
      const timestamp = this.clock().toISOString();
      const invalid = invalidateApproval(state, timestamp);
      await this.commit(
        invalid,
        state.stateVersion,
        event(invalid, 'delivery.invalidated', timestamp, { drift }),
      );
      throw new Error(`Approved delivery snapshot drifted: ${drift.join(', ')}`);
    }
    for (const action of state.snapshot.plan) {
      const result = state.actionResults.find((item) => item.actionId === action.actionId)!;
      if (result.status === 'succeeded') continue;
      const timestamp = this.clock().toISOString();
      const running: DeliveryState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        status: 'publishing',
        actionResults: state.actionResults.map((item) =>
          item.actionId === action.actionId
            ? { ...item, status: 'running', attempts: item.attempts + 1, startedAt: timestamp }
            : item,
        ),
        updatedAt: timestamp,
      };
      await this.commit(
        running,
        state.stateVersion,
        event(running, 'delivery.action', timestamp, {
          actionId: action.actionId,
          actionType: action.type,
          result: 'running',
        }),
      );
      state = running;
      try {
        const repository = repositories.get(action.repositoryId)!;
        let remoteOid: string | undefined;
        let mergeRequest: MergeRequestIdentity | undefined;
        if (action.type === 'git.push')
          remoteOid = await this.git.push(repository, action, options.policy);
        else if (action.type === 'mr.create_or_update') {
          if (!repository.remoteIdentity)
            throw new Error(`Repository has no remote identity: ${repository.id}`);
          const input = this.mergeRequestInput(
            repository,
            action.sourceBranch,
            action.targetBranch,
            options.intent.changeId,
            options.reportContents,
            options.policy,
          );
          const existing = await this.mergeRequests.find(input);
          mergeRequest = existing
            ? await this.mergeRequests.update(existing, input)
            : await this.mergeRequests.create(input);
        } else throw new Error(`Unsupported publication action: ${action.type}`);
        const completedAt = this.clock().toISOString();
        const completed: DeliveryState = {
          ...state,
          stateVersion: state.stateVersion + 1,
          status: 'publishing',
          actionResults: state.actionResults.map((item) =>
            item.actionId === action.actionId
              ? {
                  ...item,
                  status: 'succeeded',
                  completedAt,
                  ...(remoteOid ? { remoteOid } : {}),
                  ...(mergeRequest ? { mergeRequest } : {}),
                }
              : item,
          ),
          mergeRequests: mergeRequest
            ? recordBusinessMergeRequest(state.mergeRequests!, action.repositoryId, mergeRequest)
            : state.mergeRequests,
          updatedAt: completedAt,
        };
        await this.commit(
          completed,
          state.stateVersion,
          event(completed, 'delivery.action', completedAt, {
            actionId: action.actionId,
            actionType: action.type,
            result: 'succeeded',
          }),
        );
        state = completed;
      } catch (error) {
        const failedAt = this.clock().toISOString();
        const failed: DeliveryState = {
          ...state,
          stateVersion: state.stateVersion + 1,
          status: 'partially_published',
          actionResults: state.actionResults.map((item) =>
            item.actionId === action.actionId
              ? {
                  ...item,
                  status: 'failed',
                  completedAt: failedAt,
                  errorCode: 'publication.action-failed',
                }
              : item,
          ),
          updatedAt: failedAt,
        };
        await this.commit(
          failed,
          state.stateVersion,
          event(failed, 'delivery.action', failedAt, {
            actionId: action.actionId,
            actionType: action.type,
            result: 'failed',
          }),
        );
        throw error;
      }
    }
    const completedAt = this.clock().toISOString();
    const complete: DeliveryState = {
      ...state,
      stateVersion: state.stateVersion + 1,
      status: 'in_review',
      updatedAt: completedAt,
    };
    await this.commit(
      complete,
      state.stateVersion,
      event(complete, 'delivery.action', completedAt, { result: 'publication-complete' }),
    );
    return complete;
  }

  async refresh(changeId: string): Promise<DeliveryState> {
    return (await this.refreshWithMergeRequestStatuses(changeId)).state;
  }

  async publishPostMerge(
    request: PostMergePublicationRequest,
  ): Promise<PostMergePublicationReceipt> {
    assertPostMergePublicationRequest(request);
    const state = await this.requireState(request.changeId);
    this.assertWritableComposition(state);
    if (state.status !== 'merged') {
      throw new Error(`Post-merge publication requires merged Delivery state: ${state.status}`);
    }
    const coordination = state.mergeRequests?.coordination;
    if (!coordination) throw new Error('Delivery has no original coordination MR');
    if (!this.postMergeGit) throw new Error('Post-merge Git publication is unavailable');
    if (path.resolve(request.workspaceRoot) !== path.resolve(request.baseline.root)) {
      throw new Error('Post-merge publication root is not bound to its audited baseline');
    }

    const current = await this.mergeRequests.status(coordination.mergeRequest);
    this.assertCoordinationStatus(current, coordination);
    const git = await this.postMergeGit.publishPostMerge({
      workspaceRoot: request.workspaceRoot,
      coordination,
      baseline: request.baseline,
      audit: request.audit,
      policy: request.policy,
    });

    let afterPush = await this.mergeRequests.status(coordination.mergeRequest);
    this.assertCoordinationStatus(afterPush, coordination, git.commitOid);
    let mergeRequestRecovered =
      afterPush.title === request.policy.mergeRequest.title &&
      afterPush.body === request.policy.mergeRequest.body;
    if (!mergeRequestRecovered) {
      const updated = await this.mergeRequests.update(coordination.mergeRequest, {
        repositoryId: coordination.repositoryId,
        remoteIdentity: coordination.remoteIdentity,
        sourceBranch: coordination.sourceBranch,
        targetBranch: coordination.targetBranch,
        title: request.policy.mergeRequest.title,
        body: request.policy.mergeRequest.body,
      });
      this.assertSameMergeRequest(updated, coordination.mergeRequest);
      afterPush = await this.mergeRequests.status(coordination.mergeRequest);
      this.assertCoordinationStatus(afterPush, coordination, git.commitOid);
      if (
        afterPush.title !== request.policy.mergeRequest.title ||
        afterPush.body !== request.policy.mergeRequest.body
      ) {
        throw new Error('Original coordination MR update could not be verified');
      }
      mergeRequestRecovered = false;
    }
    return createPostMergePublicationReceipt({
      request,
      git,
      mergeRequest: coordination.mergeRequest,
      mergeRequestRecovered,
    });
  }

  private async refreshWithMergeRequestStatuses(changeId: string): Promise<{
    state: DeliveryState;
    mergeRequestStatuses: MergeRequestStatus[];
  }> {
    const state = await this.requireState(changeId);
    this.assertWritableComposition(state);
    const previousEvidence = new Map(
      state.mergeEvidence.map((item) => [
        `${item.mergeRequest.provider}\0${item.mergeRequest.repositoryId}\0${item.mergeRequest.number}`,
        item,
      ]),
    );
    const businessMergeRequests = state.mergeRequests?.business ?? [];
    const identities = businessMergeRequests.flatMap((item) =>
      item.mergeRequest ? [item.mergeRequest] : [],
    );
    const evidence: MergeEvidence[] = [];
    const mergeRequestStatuses: MergeRequestStatus[] = [];
    const platformCapabilities = [];
    for (const identity of identities) {
      const status = await this.mergeRequests.status(identity);
      mergeRequestStatuses.push(status);
      const repository = state.snapshot?.repositories.find(
        (item) => item.repositoryId === identity.repositoryId,
      );
      if (repository?.remoteIdentity) {
        platformCapabilities.push(
          await this.mergeRequests.capability(repository.remoteIdentity, repository.targetBranch),
        );
      }
      if (status.state === 'merged' && status.mergeCommit && status.mergedAt) {
        const prior = previousEvidence.get(
          `${identity.provider}\0${identity.repositoryId}\0${identity.number}`,
        );
        evidence.push({
          repositoryId: status.repositoryId,
          mergeRequest: identity,
          mergeCommit: status.mergeCommit,
          mergedAt: status.mergedAt,
          observedAt:
            prior?.repositoryId === status.repositoryId &&
            prior.mergeCommit === status.mergeCommit &&
            prior.mergedAt === status.mergedAt
              ? prior.observedAt
              : this.clock().toISOString(),
        });
      }
    }
    const timestamp = this.clock().toISOString();
    const allMerged =
      businessMergeRequests.length > 0 &&
      identities.length === businessMergeRequests.length &&
      evidence.length === businessMergeRequests.length;
    const next: DeliveryState = {
      ...state,
      stateVersion: state.stateVersion + 1,
      status: allMerged ? 'merged' : state.status,
      mergeEvidence: evidence,
      platformCapabilities,
      updatedAt: timestamp,
    };
    await this.commit(
      next,
      state.stateVersion,
      event(next, 'delivery.refreshed', timestamp, {
        mergeRequestCount: identities.length,
        mergedCount: evidence.length,
      }),
    );
    return { state: next, mergeRequestStatuses };
  }

  async refreshForMergeRequest(reference: MergeRequestReference) {
    const match = matchActiveDeliveryMergeRequest(await this.store.list(), reference);
    if (match.status !== 'matched') return { match, state: null, mergeRequestStatuses: [] };
    return { match, ...(await this.refreshWithMergeRequestStatuses(match.changeIds[0])) };
  }

  async reconciliationCandidates() {
    return (await this.store.list())
      .filter((state) => state.status === 'in_review' || state.status === 'merged')
      .flatMap((state) => {
        const business = state.mergeRequests?.business.find((item) => item.mergeRequest);
        if (!business?.mergeRequest) return [];
        return [
          {
            changeId: state.changeId,
            reference: {
              provider: business.mergeRequest.provider,
              remoteIdentity: business.remoteIdentity,
              number: business.mergeRequest.number,
            },
          },
        ];
      })
      .sort((left, right) => left.changeId.localeCompare(right.changeId));
  }

  status(changeId: string) {
    return this.requireState(changeId);
  }

  private async commit(
    state: DeliveryState,
    previousStateVersion: number | null,
    deliveryEvent: DeliveryEvent,
  ): Promise<void> {
    await this.store.commit({ state, previousStateVersion, event: deliveryEvent });
    try {
      await this.telemetry?.export(state, deliveryEvent);
    } catch {
      // Delivery facts are durable before telemetry; observability remains non-blocking.
    }
  }

  private validate(intent: DeliveryIntent, policy: DeliveryPolicy): void {
    const findings = [...validateDeliveryIntent(intent), ...validateDeliveryPolicy(policy)];
    if (findings.length > 0)
      throw new Error(`Invalid delivery input: ${findings.map((item) => item.code).join(', ')}`);
  }

  private async requireState(changeId: string): Promise<DeliveryState> {
    const state = await this.store.load(changeId);
    if (!state) throw new Error(`Delivery does not exist: ${changeId}`);
    return state;
  }

  private assertWritableComposition(state: DeliveryState): void {
    if (state.snapshot && state.snapshot.compositionDigest !== this.compositionDigest) {
      throw new Error(
        `Delivery ${state.changeId} requires composition ${state.snapshot.compositionDigest}; current composition ${this.compositionDigest} is migration_required`,
      );
    }
  }

  private assertSameMergeRequest(
    actual: MergeRequestIdentity,
    expected: MergeRequestIdentity,
  ): void {
    if (
      actual.provider !== expected.provider ||
      actual.repositoryId !== expected.repositoryId ||
      actual.number !== expected.number ||
      actual.url !== expected.url
    ) {
      throw new Error('Post-merge publication attempted to replace the original coordination MR');
    }
  }

  private assertCoordinationStatus(
    status: MergeRequestStatus,
    coordination: NonNullable<DeliveryState['mergeRequests']>['coordination'],
    expectedHead?: string,
  ): void {
    this.assertSameMergeRequest(status, coordination.mergeRequest);
    if (status.state !== 'open') {
      throw new Error(`Original coordination MR is not open: ${status.state}`);
    }
    if (
      status.sourceBranch !== coordination.sourceBranch ||
      status.targetBranch !== coordination.targetBranch
    ) {
      throw new Error('Original coordination MR branch mapping drifted');
    }
    if (!status.headCommit) {
      throw new Error('Original coordination MR did not report its head commit');
    }
    if (expectedHead && status.headCommit !== expectedHead) {
      throw new Error('Original coordination MR head commit drifted');
    }
    if (status.title === undefined || status.body === undefined) {
      throw new Error('Original coordination MR did not report editable metadata');
    }
  }

  private approvalDrift(
    state: DeliveryState,
    intent: DeliveryIntent,
    policy: DeliveryPolicy,
    reportContents: string,
    evidenceBundleIds: string[],
    facts: Awaited<ReturnType<DeliveryGitPort['inspect']>>[],
  ): string[] {
    const expected = state.snapshot!;
    const drift: string[] = [];
    if (expected.compositionDigest !== this.compositionDigest) drift.push('composition');
    if (sha256Digest(reportContents) !== expected.reportDigest) drift.push('report');
    if (deliveryPolicyDigest(policy) !== expected.policyDigest) drift.push('policy');
    if (deliveryIntentDigest(intent) !== expected.intentDigest) drift.push('intent');
    if (
      canonicalJson([...new Set(evidenceBundleIds)].sort()) !==
      canonicalJson(expected.evidenceBundleIds)
    )
      drift.push('evidence');
    for (const current of facts) {
      const original = expected.repositories.find(
        (item) => item.repositoryId === current.repositoryId,
      );
      if (!original) {
        drift.push(`repository:${current.repositoryId}:added`);
        continue;
      }
      for (const field of [
        'sourceBranch',
        'targetBranch',
        'head',
        'tree',
        'remoteTargetOid',
        'clean',
      ] as const)
        if (current[field] !== original[field])
          drift.push(`repository:${current.repositoryId}:${field}`);
      const pushDone = state.actionResults.some(
        (result) =>
          result.status === 'succeeded' &&
          expected.plan.some(
            (action) =>
              action.actionId === result.actionId &&
              action.repositoryId === current.repositoryId &&
              action.type === 'git.push',
          ),
      );
      const expectedSource = pushDone ? original.head : original.remoteSourceOid;
      if (current.remoteSourceOid !== expectedSource)
        drift.push(`repository:${current.repositoryId}:remoteSourceOid`);
    }
    return [...new Set(drift)];
  }

  private mergeRequestInput(
    repository: RepositorySnapshot,
    sourceBranch: string,
    targetBranch: string,
    changeId: string,
    report: string,
    policy: DeliveryPolicy,
  ): MergeRequestInput {
    const values = { changeId, verificationReport: report };
    return {
      repositoryId: repository.id,
      remoteIdentity: repository.remoteIdentity!,
      sourceBranch,
      targetBranch,
      title: render(policy.publication.mrTitleTemplate, values),
      body: render(policy.publication.mrBodyTemplate, values),
    };
  }
}
