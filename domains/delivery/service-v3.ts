import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ProjectSnapshot, RepositorySnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { recordBusinessMergeRequestV3 } from './merge-requests.js';
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
  DeliveryStateV3,
  HumanDecisionResponse,
  MergeRequestIdentity,
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
    if ([...selected.values()].some((item) => item.id === repository.id)) {
      throw new Error(
        'Multiple Business deliveries in one repository require explicit v3.1 support',
      );
    }
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
