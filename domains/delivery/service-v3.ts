import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ProjectSnapshot, RepositorySnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  matchActiveDeliveryMergeRequestV3,
  recordBusinessMergeRequestV3,
} from './merge-requests.js';
import type {
  DeliveryEvent,
  DeliveryEvidencePort,
  DeliveryGitPort,
  DeliveryV3StorePort,
  MergeRequestPort,
} from './ports.js';
import { deliveryPolicyDigest, sha256Digest } from './snapshot.js';
import type {
  BusinessDeliveryFactsV3,
  BusinessDeliveryIntentV3,
  DeliveryIntentV3,
  DeliveryPolicy,
  DeliveryReconciliationCandidate,
  DeliveryStateV3,
  HumanDecisionResponse,
  MergeRequestIdentity,
  MergeRequestReference,
  MergeRequestStatus,
  TrustedActor,
} from './types.js';
import {
  assertDeliveryIntentV3,
  createDeliverySnapshotV3,
  deliveryIntentDigestV3,
  initialDeliveryStateV3,
  invalidateDeliveryApprovalV3,
  recordHumanDecisionV3,
  requestDeliveryApprovalV3,
} from './v3.js';
import { validateDeliveryPolicy } from './validation.js';
import {
  ResumablePublicationExecutor,
  type PublicationItemExecutor,
  type PublicationJournalItemIntent,
  type PublicationJournalStore,
} from './publication-journal.js';
import { observeMergeRequest, observeOrCreateMergeRequest } from './stable-publication.js';
import type { PublicationProvenance, PublicationReceiptItem } from './publication-receipt.js';

export interface DeliveryV3Preparation {
  runId?: string;
  project: ProjectSnapshot;
  intent: DeliveryIntentV3;
  policy: DeliveryPolicy;
  reportContents: string;
  evidenceBundleIds: string[];
  evidenceCompositionDigest?: `sha256:${string}`;
}

export interface ArchivePublicationReceipt {
  actionId: string;
  deliveryId: string;
  type: 'git.push' | 'mr.create_or_update';
  status: 'succeeded';
  recovered: boolean;
  remoteOid?: string;
  mergeRequest?: MergeRequestIdentity;
  provenance?: PublicationProvenance;
  verifiedStatus?: MergeRequestStatus;
}

export interface ArchivePublicationResult {
  snapshot: ReturnType<typeof createDeliverySnapshotV3>;
  receipts: ArchivePublicationReceipt[];
}

/** @deprecated The archive pipeline no longer waits for remote merges. */
export interface ArchiveMergeRefreshResult {
  allMerged: boolean;
  mergeRequestStatuses: MergeRequestStatus[];
  mergeEvidence: DeliveryStateV3['mergeEvidence'];
  platformCapabilities: DeliveryStateV3['platformCapabilities'];
}

function deliveryEvent(
  state: DeliveryStateV3,
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
  return template.replace(/\{\{([a-zA-Z]+)\}\}/gu, (_, key: string) => values[key] ?? '');
}

function selectedRepositories(
  project: ProjectSnapshot,
  intent: DeliveryIntentV3,
): Map<string, RepositorySnapshot> {
  const workspace = project.repositories.find(
    (repository) => path.resolve(repository.path) === path.resolve(project.root),
  );
  if (!workspace) throw new Error('Workspace snapshot does not identify its Workspace Repository');
  if (
    workspace.id !== intent.changeBranch.repositoryId ||
    workspace.remoteIdentity !== intent.changeBranch.remoteIdentity
  ) {
    throw new Error('Change branch does not belong to the Workspace Repository');
  }
  const available = new Map(project.repositories.map((repository) => [repository.id, repository]));
  const selected = new Map<string, RepositorySnapshot>();
  for (const delivery of intent.businessDeliveries) {
    if (selected.has(delivery.deliveryId)) {
      throw new Error(`Duplicate Business delivery id: ${delivery.deliveryId}`);
    }
    const repository = available.get(delivery.repositoryId);
    if (!repository) throw new Error(`Selected repository is missing: ${delivery.repositoryId}`);
    selected.set(delivery.deliveryId, repository);
  }
  return selected;
}

function businessIntent(delivery: BusinessDeliveryIntentV3) {
  return {
    repositoryId: delivery.repositoryId,
    sourceBranch: delivery.sourceBranch,
    targetBranch: delivery.targetBranch,
    commitMessage: delivery.commitMessage,
    actions: [...delivery.actions],
  };
}

export class DeliveryServiceV3 {
  constructor(
    private readonly store: DeliveryV3StorePort,
    private readonly git: DeliveryGitPort,
    private readonly mergeRequests: MergeRequestPort,
    private readonly evidence: DeliveryEvidencePort,
    private readonly publicationJournal: PublicationJournalStore,
    private readonly compositionDigest: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async checkpoint(project: ProjectSnapshot, intent: DeliveryIntentV3, policy: DeliveryPolicy) {
    this.validate(intent, policy);
    const repositories = selectedRepositories(project, intent);
    const results = [];
    for (const delivery of intent.businessDeliveries) {
      results.push(
        await this.git.checkpoint(
          repositories.get(delivery.deliveryId)!,
          businessIntent(delivery),
          policy,
        ),
      );
    }
    return results;
  }

  async prepare(options: DeliveryV3Preparation): Promise<DeliveryStateV3> {
    this.validate(options.intent, options.policy);
    await this.evidence.assertSatisfied(options.evidenceBundleIds, this.compositionDigest);
    const repositories = selectedRepositories(options.project, options.intent);
    const facts: BusinessDeliveryFactsV3[] = [];
    for (const delivery of options.intent.businessDeliveries) {
      facts.push({
        ...(await this.git.inspect(
          repositories.get(delivery.deliveryId)!,
          businessIntent(delivery),
          options.policy,
        )),
        deliveryId: delivery.deliveryId,
      });
    }
    const timestamp = this.clock().toISOString();
    const snapshot = createDeliverySnapshotV3({
      compositionDigest: this.compositionDigest,
      intent: options.intent,
      policy: options.policy,
      reportContents: options.reportContents,
      evidenceBundleIds: options.evidenceBundleIds,
      businessDeliveries: facts,
      createdAt: timestamp,
    });
    const previous = await this.store.load(options.intent.changeId);
    if (previous?.snapshot?.digest === snapshot.digest && previous.status === 'awaiting_approval') {
      return previous;
    }
    const base = previous ?? initialDeliveryStateV3(options.intent.changeId, timestamp);
    const next = requestDeliveryApprovalV3(base, snapshot, timestamp);
    await this.store.commit({
      state: next,
      previousStateVersion: previous?.stateVersion ?? null,
      event: deliveryEvent(next, 'delivery.prepared', timestamp, {
        snapshotDigest: snapshot.digest,
        businessDeliveryCount: snapshot.businessDeliveries.length,
      }),
    });
    return next;
  }

  async publishArchive(
    options: DeliveryV3Preparation & { expectedRepositoryHeads: Readonly<Record<string, string>> },
  ): Promise<ArchivePublicationResult> {
    if (!options.runId?.trim()) throw new Error('Archive publication requires a stable Run id');
    this.validate(options.intent, options.policy);
    await this.evidence.assertSatisfied(
      options.evidenceBundleIds,
      options.evidenceCompositionDigest ?? this.compositionDigest,
    );
    const repositories = selectedRepositories(options.project, options.intent);
    const priorJournal = await this.publicationJournal.load(options.runId);
    const facts: BusinessDeliveryFactsV3[] = [];
    for (const delivery of options.intent.businessDeliveries) {
      const expectedHead = options.expectedRepositoryHeads[delivery.repositoryId];
      if (!expectedHead || !/^[a-f0-9]{40,64}$/u.test(expectedHead))
        throw new Error(
          `Archive publication requires a frozen Business OID: ${delivery.repositoryId}`,
        );
      const observed = await this.git.inspect(
        repositories.get(delivery.deliveryId)!,
        businessIntent(delivery),
        options.policy,
      );
      const priorItem = priorJournal?.items.find(
        (item) => item.intent.deliveryId === delivery.deliveryId,
      );
      if (observed.head !== expectedHead && (!priorItem || priorItem.status === 'pending'))
        throw new Error(
          `Business HEAD differs from the frozen Archive OID: ${delivery.repositoryId}`,
        );
      // An unsettled operation is observed against its original OID. The push port
      // still checks expectedHead if a new push is ever legally requested.
      facts.push({
        ...observed,
        head: expectedHead,
        deliveryId: delivery.deliveryId,
      });
    }
    const snapshot = createDeliverySnapshotV3({
      compositionDigest: this.compositionDigest,
      intent: options.intent,
      policy: options.policy,
      reportContents: options.reportContents,
      evidenceBundleIds: options.evidenceBundleIds,
      businessDeliveries: facts,
      createdAt: this.clock().toISOString(),
    });
    const values = {
      changeId: options.intent.changeId,
      verificationReport: options.reportContents,
    };
    const items: PublicationJournalItemIntent[] = options.intent.businessDeliveries.map(
      (delivery) => {
        const repository = repositories.get(delivery.deliveryId)!;
        const expected = snapshot.businessDeliveries.find(
          (candidate) => candidate.deliveryId === delivery.deliveryId,
        )!;
        if (!repository.remoteIdentity) {
          throw new Error(`Repository has no remote identity: ${repository.id}`);
        }
        return {
          publicationId: `business:${delivery.deliveryId}`,
          role: 'business',
          deliveryId: delivery.deliveryId,
          repositoryId: repository.id,
          remoteIdentity: repository.remoteIdentity,
          remote: options.policy.publication.remote,
          sourceBranch: delivery.sourceBranch,
          targetBranch: delivery.targetBranch,
          mergeRequestTitle: render(options.policy.publication.mrTitleTemplate, values),
          mergeRequestBody: render(options.policy.publication.mrBodyTemplate, values),
          expectedOid: expected.head,
          operation: 'push-and-create-or-adopt-mr',
        };
      },
    );
    const resolve = (item: PublicationJournalItemIntent) => {
      const delivery = options.intent.businessDeliveries.find(
        (candidate) => candidate.deliveryId === item.deliveryId,
      )!;
      const repository = repositories.get(delivery.deliveryId)!;
      const push = snapshot.plan.find(
        (action) => action.deliveryId === delivery.deliveryId && action.type === 'git.push',
      );
      if (!push || push.type !== 'git.push') {
        throw new Error(`Business delivery has no push action: ${delivery.deliveryId}`);
      }
      const request = {
        repositoryId: item.repositoryId,
        remoteIdentity: item.remoteIdentity,
        sourceBranch: item.sourceBranch,
        targetBranch: item.targetBranch,
        title: item.mergeRequestTitle,
        body: item.mergeRequestBody,
      };
      const identity = {
        changeId: options.intent.changeId,
        runId: options.runId!,
        repositoryId: item.repositoryId,
        remoteIdentity: item.remoteIdentity,
        sourceBranch: item.sourceBranch,
        targetBranch: item.targetBranch,
        publishedOid: item.expectedOid,
      };
      return { delivery, repository, push, request, identity };
    };
    const receipt = (
      item: PublicationJournalItemIntent,
      observed: Awaited<ReturnType<typeof observeMergeRequest>>,
    ): PublicationReceiptItem | null =>
      observed
        ? {
            publicationId: item.publicationId,
            role: item.role,
            ...(item.deliveryId ? { deliveryId: item.deliveryId } : {}),
            repositoryId: item.repositoryId,
            remoteIdentity: item.remoteIdentity,
            remote: item.remote,
            sourceBranch: item.sourceBranch,
            targetBranch: item.targetBranch,
            publishedOid: item.expectedOid,
            mergeRequest: observed.identity,
            provenance: observed.provenance,
            verifiedAt: this.clock().toISOString(),
          }
        : null;
    const adapter: PublicationItemExecutor = {
      observePush: async (item) => {
        const { delivery, repository } = resolve(item);
        return (await this.git.inspect(repository, businessIntent(delivery), options.policy))
          .remoteSourceOid;
      },
      push: (item) => {
        const { repository, push } = resolve(item);
        return this.git.push(repository, push, options.policy);
      },
      observeMergeRequest: async (item) => {
        const { request, identity } = resolve(item);
        return receipt(
          item,
          await observeMergeRequest({ port: this.mergeRequests, request, identity }),
        );
      },
      createMergeRequest: async (item) => {
        const { request, identity } = resolve(item);
        return receipt(
          item,
          await observeOrCreateMergeRequest({ port: this.mergeRequests, request, identity }),
        )!;
      },
    };
    const journal = await new ResumablePublicationExecutor(
      this.publicationJournal,
      adapter,
    ).publish({ changeId: options.intent.changeId, runId: options.runId, items });
    const receipts: ArchivePublicationReceipt[] = [];
    for (const item of journal.items) {
      if (!item.result || !item.intent.deliveryId) {
        throw new Error(`Business publication Journal is incomplete: ${item.intent.publicationId}`);
      }
      const push = snapshot.plan.find(
        (action) => action.deliveryId === item.intent.deliveryId && action.type === 'git.push',
      )!;
      const mergeRequest = snapshot.plan.find(
        (action) =>
          action.deliveryId === item.intent.deliveryId && action.type === 'mr.create_or_update',
      )!;
      receipts.push({
        actionId: push.actionId,
        deliveryId: item.intent.deliveryId,
        type: 'git.push',
        status: 'succeeded',
        recovered: item.attempts === 0,
        remoteOid: item.intent.expectedOid,
      });
      receipts.push({
        actionId: mergeRequest.actionId,
        deliveryId: item.intent.deliveryId,
        type: 'mr.create_or_update',
        status: 'succeeded',
        recovered: item.result.provenance !== 'runtime-created',
        mergeRequest: item.result.mergeRequest,
        provenance: item.result.provenance,
        verifiedStatus: await this.mergeRequests.status(item.result.mergeRequest),
      });
    }
    return { snapshot, receipts };
  }

  async decide(
    changeId: string,
    response: HumanDecisionResponse,
    actor: TrustedActor,
  ): Promise<DeliveryStateV3> {
    const previous = await this.requireState(changeId);
    if (
      previous.approval?.requestId === response.requestId &&
      previous.approval.snapshotDigest === response.snapshotDigest &&
      previous.approval.decision === response.decision
    ) {
      return previous;
    }
    const timestamp = this.clock().toISOString();
    const next = recordHumanDecisionV3(previous, response, actor, timestamp);
    await this.store.commit({
      state: next,
      previousStateVersion: previous.stateVersion,
      event: deliveryEvent(next, 'delivery.decided', timestamp, {
        decision: response.decision,
        snapshotDigest: response.snapshotDigest,
      }),
    });
    return next;
  }

  async publish(options: DeliveryV3Preparation): Promise<DeliveryStateV3> {
    let state = await this.requireState(options.intent.changeId);
    if (!state.snapshot || !state.approval || state.approval.decision !== 'approve') {
      throw new Error('Delivery does not have an effective approval');
    }
    if (!['approved', 'partially_published', 'publishing'].includes(state.status)) {
      throw new Error(`Delivery cannot publish from ${state.status}`);
    }
    const repositories = selectedRepositories(options.project, options.intent);
    const currentFacts: BusinessDeliveryFactsV3[] = [];
    for (const delivery of options.intent.businessDeliveries) {
      currentFacts.push({
        ...(await this.git.inspect(
          repositories.get(delivery.deliveryId)!,
          businessIntent(delivery),
          options.policy,
        )),
        deliveryId: delivery.deliveryId,
      });
    }
    const drift = this.approvalDrift(state, options, currentFacts);
    if (drift.length > 0) {
      const timestamp = this.clock().toISOString();
      const invalid = invalidateDeliveryApprovalV3(state, timestamp);
      await this.store.commit({
        state: invalid,
        previousStateVersion: state.stateVersion,
        event: deliveryEvent(invalid, 'delivery.invalidated', timestamp, { drift }),
      });
      throw new Error(`Approved delivery snapshot drifted: ${drift.join(', ')}`);
    }
    for (const action of state.snapshot.plan) {
      const result = state.actionResults.find((item) => item.actionId === action.actionId);
      if (!result) throw new Error(`Delivery action result is missing: ${action.actionId}`);
      if (result.status === 'succeeded') continue;
      state = await this.recordAction(state, action.actionId, 'running');
      try {
        const repository = repositories.get(action.deliveryId)!;
        let remoteOid: string | undefined;
        let mergeRequest: MergeRequestIdentity | undefined;
        if (action.type === 'git.push') {
          remoteOid = await this.git.push(repository, action, options.policy);
        } else if (action.type === 'mr.create_or_update') {
          if (!repository.remoteIdentity) {
            throw new Error(`Repository has no remote identity: ${repository.id}`);
          }
          const values = {
            changeId: options.intent.changeId,
            verificationReport: options.reportContents,
          };
          const input = {
            repositoryId: repository.id,
            remoteIdentity: repository.remoteIdentity,
            sourceBranch: action.sourceBranch,
            targetBranch: action.targetBranch,
            title: render(options.policy.publication.mrTitleTemplate, values),
            body: render(options.policy.publication.mrBodyTemplate, values),
          };
          const existing = await this.mergeRequests.find(input);
          mergeRequest = existing
            ? await this.mergeRequests.update(existing, input)
            : await this.mergeRequests.create(input);
        } else {
          throw new Error(`Unsupported Business publication action: ${action.type}`);
        }
        state = await this.recordAction(state, action.actionId, 'succeeded', {
          ...(remoteOid ? { remoteOid } : {}),
          ...(mergeRequest ? { mergeRequest } : {}),
          deliveryId: action.deliveryId,
        });
      } catch (error) {
        await this.recordAction(state, action.actionId, 'failed');
        throw error;
      }
    }
    const timestamp = this.clock().toISOString();
    const complete: DeliveryStateV3 = {
      ...state,
      stateVersion: state.stateVersion + 1,
      status: 'in_review',
      updatedAt: timestamp,
    };
    await this.store.commit({
      state: complete,
      previousStateVersion: state.stateVersion,
      event: deliveryEvent(complete, 'delivery.action', timestamp, {
        result: 'publication-complete',
      }),
    });
    return complete;
  }

  status(changeId: string): Promise<DeliveryStateV3> {
    return this.requireState(changeId);
  }

  async refreshForMergeRequest(reference: MergeRequestReference) {
    const match = matchActiveDeliveryMergeRequestV3(await this.store.list(), reference);
    if (match.status !== 'matched') {
      return { match, state: null, mergeRequestStatuses: [] };
    }
    return { match, ...(await this.refreshMergeRequests(match.changeIds[0])) };
  }

  async refresh(changeId: string) {
    return this.refreshMergeRequests(changeId);
  }

  async reconciliationCandidates(): Promise<DeliveryReconciliationCandidate[]> {
    return (await this.store.list())
      .filter((state) => state.status === 'in_review' || state.status === 'merged')
      .flatMap((state) => {
        const business = [...state.businessMergeRequests]
          .sort((left, right) => left.deliveryId.localeCompare(right.deliveryId))
          .find((item) => item.mergeRequest);
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

  private async refreshMergeRequests(changeId: string) {
    const state = await this.requireState(changeId);
    const identities = state.businessMergeRequests.flatMap((item) =>
      item.mergeRequest ? [item.mergeRequest] : [],
    );
    const mergeRequestStatuses = await Promise.all(
      identities.map((identity) => this.mergeRequests.status(identity)),
    );
    const previousEvidence = new Map(
      state.mergeEvidence.map((item) => [
        `${item.mergeRequest.provider}\0${item.mergeRequest.repositoryId}\0${item.mergeRequest.number}`,
        item,
      ]),
    );
    const evidence = mergeRequestStatuses.flatMap((status) => {
      const delivery = state.businessMergeRequests.find(
        (item) =>
          item.mergeRequest?.provider === status.provider &&
          item.mergeRequest.repositoryId === status.repositoryId &&
          item.mergeRequest.number === status.number,
      );
      if (!delivery) throw new Error('Authoritative Business MR is not declared');
      const expected = state.snapshot?.businessDeliveries.find(
        (item) => item.deliveryId === delivery.deliveryId,
      );
      if (
        !expected ||
        status.sourceBranch !== delivery.sourceBranch ||
        status.targetBranch !== delivery.targetBranch ||
        status.headCommit !== expected.head
      ) {
        throw new Error(`Business merge request mapping drifted: ${delivery.deliveryId}`);
      }
      if (status.state !== 'merged' || !status.mergeCommit || !status.mergedAt) return [];
      const key = `${status.provider}\0${status.repositoryId}\0${status.number}`;
      const prior = previousEvidence.get(key);
      return [
        {
          deliveryId: delivery.deliveryId,
          repositoryId: status.repositoryId,
          mergeRequest: {
            provider: status.provider,
            repositoryId: status.repositoryId,
            number: status.number,
            url: status.url,
          },
          mergeCommit: status.mergeCommit,
          mergedAt: status.mergedAt,
          observedAt:
            prior?.mergeCommit === status.mergeCommit && prior.mergedAt === status.mergedAt
              ? prior.observedAt
              : this.clock().toISOString(),
        },
      ];
    });
    const platformCapabilities = await Promise.all(
      state.businessMergeRequests.map((item) =>
        this.mergeRequests.capability(item.remoteIdentity, item.targetBranch),
      ),
    );
    const allMerged =
      state.businessMergeRequests.length > 0 &&
      identities.length === state.businessMergeRequests.length &&
      evidence.length === state.businessMergeRequests.length;
    const timestamp = this.clock().toISOString();
    const next: DeliveryStateV3 = {
      ...state,
      stateVersion: state.stateVersion + 1,
      status: allMerged ? 'merged' : state.status,
      mergeEvidence: evidence,
      platformCapabilities,
      updatedAt: timestamp,
    };
    await this.store.commit({
      state: next,
      previousStateVersion: state.stateVersion,
      event: deliveryEvent(next, 'delivery.refreshed', timestamp, {
        mergeRequestCount: identities.length,
        mergedCount: evidence.length,
      }),
    });
    return { state: next, mergeRequestStatuses };
  }

  private async recordAction(
    state: DeliveryStateV3,
    actionId: string,
    result: 'running' | 'succeeded' | 'failed',
    output: {
      remoteOid?: string;
      mergeRequest?: MergeRequestIdentity;
      deliveryId?: string;
    } = {},
  ): Promise<DeliveryStateV3> {
    const timestamp = this.clock().toISOString();
    const next: DeliveryStateV3 = {
      ...state,
      stateVersion: state.stateVersion + 1,
      status: result === 'failed' ? 'partially_published' : 'publishing',
      actionResults: state.actionResults.map((item) =>
        item.actionId === actionId
          ? {
              ...item,
              status: result,
              attempts: result === 'running' ? item.attempts + 1 : item.attempts,
              ...(result === 'running' ? { startedAt: timestamp } : { completedAt: timestamp }),
              ...(output.remoteOid ? { remoteOid: output.remoteOid } : {}),
              ...(output.mergeRequest ? { mergeRequest: output.mergeRequest } : {}),
              ...(result === 'failed' ? { errorCode: 'publication.action-failed' } : {}),
            }
          : item,
      ),
      businessMergeRequests:
        output.mergeRequest && output.deliveryId
          ? recordBusinessMergeRequestV3(
              state.businessMergeRequests,
              output.deliveryId,
              output.mergeRequest,
            )
          : state.businessMergeRequests,
      updatedAt: timestamp,
    };
    await this.store.commit({
      state: next,
      previousStateVersion: state.stateVersion,
      event: deliveryEvent(next, 'delivery.action', timestamp, {
        actionId,
        result,
      }),
    });
    return next;
  }

  private approvalDrift(
    state: DeliveryStateV3,
    options: DeliveryV3Preparation,
    facts: BusinessDeliveryFactsV3[],
  ): string[] {
    const expected = state.snapshot!;
    const drift: string[] = [];
    if (expected.compositionDigest !== this.compositionDigest) drift.push('composition');
    if (sha256Digest(options.reportContents) !== expected.reportDigest) drift.push('report');
    if (deliveryPolicyDigest(options.policy) !== expected.policyDigest) drift.push('policy');
    if (deliveryIntentDigestV3(options.intent) !== expected.intentDigest) drift.push('intent');
    if (
      canonicalJson([...new Set(options.evidenceBundleIds)].sort()) !==
      canonicalJson(expected.evidenceBundleIds)
    ) {
      drift.push('evidence');
    }
    for (const current of facts) {
      const original = expected.businessDeliveries.find(
        (item) => item.deliveryId === current.deliveryId,
      );
      if (!original) {
        drift.push(`business:${current.deliveryId}:added`);
        continue;
      }
      for (const field of [
        'repositoryId',
        'sourceBranch',
        'targetBranch',
        'head',
        'tree',
        'remoteTargetOid',
        'clean',
      ] as const) {
        if (current[field] !== original[field])
          drift.push(`business:${current.deliveryId}:${field}`);
      }
      const pushDone = state.actionResults.some(
        (item) =>
          item.status === 'succeeded' &&
          expected.plan.some(
            (action) =>
              action.actionId === item.actionId &&
              action.deliveryId === current.deliveryId &&
              action.type === 'git.push',
          ),
      );
      const expectedSource = pushDone ? original.head : original.remoteSourceOid;
      if (current.remoteSourceOid !== expectedSource) {
        drift.push(`business:${current.deliveryId}:remoteSourceOid`);
      }
    }
    return [...new Set(drift)];
  }

  private validate(intent: DeliveryIntentV3, policy: DeliveryPolicy): void {
    assertDeliveryIntentV3(intent);
    const findings = validateDeliveryPolicy(policy);
    if (findings.length > 0) {
      throw new Error(`Invalid delivery input: ${findings.map((item) => item.code).join(', ')}`);
    }
  }

  private async requireState(changeId: string): Promise<DeliveryStateV3> {
    const state = await this.store.load(changeId);
    if (!state) throw new Error(`Delivery does not exist: ${changeId}`);
    if (state.snapshot && state.snapshot.compositionDigest !== this.compositionDigest) {
      throw new Error(`Delivery ${changeId} requires another composition: migration_required`);
    }
    return state;
  }
}
