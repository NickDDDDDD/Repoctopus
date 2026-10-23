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
  DeliveryTelemetryPort,
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
import type { FinalChangePublicationService } from './final-change-publication.js';
import {
  assertPostMergePublicationRequestV2,
  type PostMergePublicationReceiptV2,
  type PostMergePublicationRequestV2,
} from './post-merge.js';

export interface DeliveryV3Preparation {
  project: ProjectSnapshot;
  intent: DeliveryIntentV3;
  policy: DeliveryPolicy;
  reportContents: string;
  evidenceBundleIds: string[];
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
    private readonly compositionDigest: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly finalPublication?: Pick<FinalChangePublicationService, 'publish'>,
    private readonly telemetry?: DeliveryTelemetryPort,
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
    await this.commit({
      state: next,
      previousStateVersion: previous?.stateVersion ?? null,
      event: deliveryEvent(next, 'delivery.prepared', timestamp, {
        snapshotDigest: snapshot.digest,
        businessDeliveryCount: snapshot.businessDeliveries.length,
      }),
    });
    return next;
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
    await this.commit({
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
      await this.commit({
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
    await this.commit({
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
    await this.commit({
      state: next,
      previousStateVersion: state.stateVersion,
      event: deliveryEvent(next, 'delivery.refreshed', timestamp, {
        mergeRequestCount: identities.length,
        mergedCount: evidence.length,
      }),
    });
    return { state: next, mergeRequestStatuses };
  }

  async publishFinalChange(
    request: PostMergePublicationRequestV2,
  ): Promise<PostMergePublicationReceiptV2> {
    assertPostMergePublicationRequestV2(request);
    const state = await this.requireState(request.changeId);
    if (!state.snapshot || state.status !== 'merged') {
      throw new Error(`Final Change publication requires merged Business delivery state`);
    }
    if (
      canonicalJson(state.snapshot.changeBranch) !==
      canonicalJson(request.targetMerge.intent.changeBranch)
    ) {
      throw new Error('Final Change publication branch drifted from the approved Delivery');
    }
    if (!this.finalPublication) {
      throw new Error('Final Change publication is unavailable');
    }

    const startedAt = this.clock().toISOString();
    const starting: DeliveryStateV3 = {
      ...state,
      stateVersion: state.stateVersion + 1,
      closure: {
        status: 'running',
        evidenceBundleId: request.evidenceBundleId,
        specificationClosureId: request.audit.closureId,
        publishedOid: null,
        errorCode: null,
      },
      finalChangeMergeRequest: { status: 'creating', mergeRequest: null, errorCode: null },
      updatedAt: startedAt,
    };
    await this.commit({
      state: starting,
      previousStateVersion: state.stateVersion,
      event: deliveryEvent(starting, 'delivery.action', startedAt, {
        result: 'final-change-publication-started',
        runId: request.runId,
      }),
    });

    try {
      const receipt = await this.finalPublication.publish(request);
      const existing = state.finalChangeMergeRequest?.mergeRequest;
      if (
        existing &&
        (existing.provider !== receipt.mergeRequest.provider ||
          existing.repositoryId !== receipt.mergeRequest.repositoryId ||
          existing.number !== receipt.mergeRequest.number ||
          existing.url !== receipt.mergeRequest.url)
      ) {
        throw new Error('Final Change MR identity drifted from Delivery state');
      }
      const completedAt = this.clock().toISOString();
      const completed: DeliveryStateV3 = {
        ...starting,
        stateVersion: starting.stateVersion + 1,
        closure: {
          status: 'succeeded',
          evidenceBundleId: request.evidenceBundleId,
          specificationClosureId: request.audit.closureId,
          publishedOid: receipt.remoteOid,
          errorCode: null,
        },
        finalChangeMergeRequest: {
          status: 'open',
          mergeRequest: structuredClone(receipt.mergeRequest),
          errorCode: null,
        },
        updatedAt: completedAt,
      };
      await this.commit({
        state: completed,
        previousStateVersion: starting.stateVersion,
        event: deliveryEvent(completed, 'delivery.action', completedAt, {
          result: 'final-change-published',
          receiptDigest: receipt.digest,
        }),
      });
      return receipt;
    } catch (error) {
      const failedAt = this.clock().toISOString();
      const failed: DeliveryStateV3 = {
        ...starting,
        stateVersion: starting.stateVersion + 1,
        closure: {
          ...starting.closure!,
          status: 'failed',
          errorCode: 'final-change-publication-failed',
        },
        finalChangeMergeRequest: {
          status: 'failed',
          mergeRequest: state.finalChangeMergeRequest?.mergeRequest ?? null,
          errorCode: 'final-change-publication-failed',
        },
        updatedAt: failedAt,
      };
      await this.commit({
        state: failed,
        previousStateVersion: starting.stateVersion,
        event: deliveryEvent(failed, 'delivery.action', failedAt, {
          result: 'final-change-publication-failed',
        }),
      });
      throw error;
    }
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
    await this.commit({
      state: next,
      previousStateVersion: state.stateVersion,
      event: deliveryEvent(next, 'delivery.action', timestamp, {
        actionId,
        result,
      }),
    });
    return next;
  }

  private async commit(options: Parameters<DeliveryV3StorePort['commit']>[0]): Promise<void> {
    await this.store.commit(options);
    try {
      await this.telemetry?.export(options.state, options.event);
    } catch {
      // Delivery facts are durable before telemetry; observability remains non-blocking.
    }
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
