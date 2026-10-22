import { randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { deliveryPolicyDigest, sha256, sha256Digest } from './snapshot.js';
import type {
  ApprovalRecord,
  BusinessDeliveryFactsV3,
  BusinessDeliveryIntentV3,
  DeliveryIntentV3,
  DeliveryPolicy,
  DeliverySnapshotV3,
  DeliveryStateV3,
  HumanDecisionRequestV3,
  HumanDecisionResponse,
  PublicationActionV3,
  TrustedActor,
} from './types.js';

const CHANGE_ID = /^[a-z0-9][a-z0-9-]{2,127}$/u;
const DELIVERY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const GIT_OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
}

function normalizeBusinessDelivery(delivery: BusinessDeliveryIntentV3): BusinessDeliveryIntentV3 {
  return {
    ...delivery,
    actions: [...new Set(delivery.actions)].sort((left, right) =>
      left === 'push' ? -1 : right === 'push' ? 1 : left.localeCompare(right),
    ),
  };
}

export function normalizeDeliveryIntentV3(intent: DeliveryIntentV3): DeliveryIntentV3 {
  return {
    ...intent,
    changeBranch: structuredClone(intent.changeBranch),
    businessDeliveries: intent.businessDeliveries
      .map(normalizeBusinessDelivery)
      .sort((left, right) => left.deliveryId.localeCompare(right.deliveryId)),
    ...(intent.businessSplitReason
      ? { businessSplitReason: structuredClone(intent.businessSplitReason) }
      : {}),
  };
}

export function assertDeliveryIntentV3(intent: DeliveryIntentV3): void {
  if (intent.schemaVersion !== 3) throw new Error('Delivery intent v3 is required');
  if (!CHANGE_ID.test(intent.changeId)) throw new Error('Delivery change id is invalid');
  const branch = intent.changeBranch;
  for (const [field, value] of [
    ['repositoryId', branch.repositoryId],
    ['remoteIdentity', branch.remoteIdentity],
    ['sourceBranch', branch.sourceBranch],
    ['targetBranch', branch.targetBranch],
    ['remoteOid', branch.remoteOid],
  ] as const) {
    requireText(value, `Change branch ${field}`);
  }
  if (branch.sourceBranch === branch.targetBranch) {
    throw new Error('Change branch source and target branches must differ');
  }
  if (!GIT_OID.test(branch.remoteOid)) {
    throw new Error('Change branch remote OID must be a published Git commit');
  }
  if (intent.businessDeliveries.length === 0) {
    throw new Error('Delivery intent requires at least one Business delivery');
  }
  const deliveryIds = new Set<string>();
  const mergeRequestMappings = new Set<string>();
  const targetBranchesByRepository = new Map<string, string>();
  for (const delivery of intent.businessDeliveries) {
    if (!DELIVERY_ID.test(delivery.deliveryId)) {
      throw new Error(`Business delivery id is invalid: ${delivery.deliveryId}`);
    }
    if (deliveryIds.has(delivery.deliveryId)) {
      throw new Error(`Duplicate Business delivery id: ${delivery.deliveryId}`);
    }
    deliveryIds.add(delivery.deliveryId);
    requireText(delivery.repositoryId, `Business delivery ${delivery.deliveryId} repository`);
    requireText(delivery.sourceBranch, `Business delivery ${delivery.deliveryId} source branch`);
    requireText(delivery.targetBranch, `Business delivery ${delivery.deliveryId} target branch`);
    requireText(delivery.commitMessage, `Business delivery ${delivery.deliveryId} commit message`);
    if (delivery.sourceBranch === delivery.targetBranch) {
      throw new Error(`Business delivery ${delivery.deliveryId} source and target branches match`);
    }
    const repositoryTarget = targetBranchesByRepository.get(delivery.repositoryId);
    if (repositoryTarget && repositoryTarget !== delivery.targetBranch) {
      throw new Error(
        `Business deliveries for repository ${delivery.repositoryId} must use one target branch`,
      );
    }
    targetBranchesByRepository.set(delivery.repositoryId, delivery.targetBranch);
    const mergeRequestMapping = [
      delivery.repositoryId,
      delivery.sourceBranch,
      delivery.targetBranch,
    ].join('\0');
    if (mergeRequestMappings.has(mergeRequestMapping)) {
      throw new Error(
        `Business delivery ${delivery.deliveryId} duplicates another merge request mapping`,
      );
    }
    mergeRequestMappings.add(mergeRequestMapping);
    if (
      delivery.actions.length !== 2 ||
      new Set(delivery.actions).size !== delivery.actions.length ||
      !delivery.actions.includes('push') ||
      !delivery.actions.includes('merge_request') ||
      delivery.actions.some((action) => action !== 'push' && action !== 'merge_request')
    ) {
      throw new Error(
        `Business delivery ${delivery.deliveryId} must request one push and one merge request`,
      );
    }
  }
  if (intent.businessDeliveries.length > 1) {
    if (!intent.businessSplitReason?.summary.trim()) {
      throw new Error('Multiple Business deliveries require a split reason');
    }
    if (
      !['multi_repository', 'ordered_delivery', 'supplemental_fix'].includes(
        intent.businessSplitReason.kind,
      )
    ) {
      throw new Error('Business delivery split reason kind is invalid');
    }
  } else if (intent.businessSplitReason) {
    throw new Error('A single Business delivery must not declare a split reason');
  }
}

export function parseDeliveryIntentV3(value: unknown): DeliveryIntentV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Delivery Intent must be an object using schemaVersion 3');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 2 || 'changeMergeRequest' in candidate) {
    throw new Error(
      'Delivery Intent v2 is read-only. Migrate changeMergeRequest to changeBranch with its published remoteOid, rename repositories to businessDeliveries with a stable deliveryId, remove the old MR identity, and obtain a new planning approval.',
    );
  }
  if (candidate.schemaVersion !== 3) {
    throw new Error('Unsupported Delivery Intent schemaVersion; schemaVersion 3 is required');
  }
  try {
    assertDeliveryIntentV3(candidate as unknown as DeliveryIntentV3);
    return normalizeDeliveryIntentV3(candidate as unknown as DeliveryIntentV3);
  } catch (error) {
    throw new Error(
      `Invalid Delivery Intent v3: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function createDefaultDeliveryIntentV3(input: {
  changeId: string;
  changeBranch: DeliveryIntentV3['changeBranch'];
  businessDelivery: Omit<BusinessDeliveryIntentV3, 'deliveryId'>;
}): DeliveryIntentV3 {
  const intent: DeliveryIntentV3 = {
    schemaVersion: 3,
    changeId: input.changeId,
    changeBranch: structuredClone(input.changeBranch),
    businessDeliveries: [{ deliveryId: 'primary', ...structuredClone(input.businessDelivery) }],
  };
  assertDeliveryIntentV3(intent);
  return normalizeDeliveryIntentV3(intent);
}

export function deliveryIntentDigestV3(intent: DeliveryIntentV3): string {
  assertDeliveryIntentV3(intent);
  return sha256Digest(canonicalJson(normalizeDeliveryIntentV3(intent)));
}

export function createPublicationPlanV3(
  intent: DeliveryIntentV3,
  facts: readonly BusinessDeliveryFactsV3[],
): PublicationActionV3[] {
  assertDeliveryIntentV3(intent);
  const byId = new Map(facts.map((item) => [item.deliveryId, item]));
  if (byId.size !== facts.length) throw new Error('Business delivery facts contain duplicate IDs');
  if (facts.length !== intent.businessDeliveries.length) {
    throw new Error('Business delivery facts do not match the complete intent collection');
  }
  const actions: PublicationActionV3[] = [];
  for (const delivery of normalizeDeliveryIntentV3(intent).businessDeliveries) {
    const fact = byId.get(delivery.deliveryId);
    if (!fact) throw new Error(`Business delivery facts are missing: ${delivery.deliveryId}`);
    if (
      fact.repositoryId !== delivery.repositoryId ||
      fact.sourceBranch !== delivery.sourceBranch ||
      fact.targetBranch !== delivery.targetBranch
    ) {
      throw new Error(`Business delivery facts do not match intent: ${delivery.deliveryId}`);
    }
    for (const requested of normalizeBusinessDelivery(delivery).actions) {
      const type = requested === 'push' ? 'git.push' : 'mr.create_or_update';
      const identity = [
        intent.changeId,
        delivery.deliveryId,
        delivery.repositoryId,
        type,
        delivery.sourceBranch,
        delivery.targetBranch,
      ].join('\0');
      actions.push({
        actionId: sha256(identity).slice(0, 24),
        type,
        deliveryId: delivery.deliveryId,
        repositoryId: delivery.repositoryId,
        sourceBranch: delivery.sourceBranch,
        targetBranch: delivery.targetBranch,
        expectedHead: fact.head,
        expectedRemoteSourceOid: fact.remoteSourceOid,
        expectedRemoteTargetOid: fact.remoteTargetOid,
      });
    }
  }
  return actions;
}

export function createDeliverySnapshotV3(options: {
  compositionDigest: string;
  intent: DeliveryIntentV3;
  policy: DeliveryPolicy;
  reportContents: string;
  evidenceBundleIds: string[];
  businessDeliveries: BusinessDeliveryFactsV3[];
  createdAt: string;
}): DeliverySnapshotV3 {
  const intent = normalizeDeliveryIntentV3(options.intent);
  assertDeliveryIntentV3(intent);
  const evidenceBundleIds = [...new Set(options.evidenceBundleIds)].sort();
  if (evidenceBundleIds.length === 0 || evidenceBundleIds.some((id) => !id.trim())) {
    throw new Error('Delivery approval requires at least one Evidence Bundle');
  }
  const businessDeliveries = [...options.businessDeliveries].sort((left, right) =>
    left.deliveryId.localeCompare(right.deliveryId),
  );
  if (businessDeliveries.some((delivery) => !delivery.clean)) {
    throw new Error('All Business deliveries must be clean before approval');
  }
  if (businessDeliveries.some((delivery) => !delivery.remoteIdentity)) {
    throw new Error('All Business deliveries must have a remote identity before approval');
  }
  const plan = createPublicationPlanV3(intent, businessDeliveries);
  const stable = {
    schemaVersion: 3 as const,
    changeId: intent.changeId,
    compositionDigest: options.compositionDigest,
    reportDigest: sha256Digest(options.reportContents),
    policyDigest: deliveryPolicyDigest(options.policy),
    intentDigest: deliveryIntentDigestV3(intent),
    evidenceBundleIds,
    changeBranch: structuredClone(intent.changeBranch),
    businessDeliveries,
    businessSplitReason: intent.businessSplitReason
      ? structuredClone(intent.businessSplitReason)
      : null,
    plan,
  };
  return { ...stable, digest: sha256Digest(canonicalJson(stable)), createdAt: options.createdAt };
}

export function compareDeliverySnapshotsV3(
  expected: DeliverySnapshotV3,
  current: DeliverySnapshotV3,
): string[] {
  const compared: Array<keyof DeliverySnapshotV3> = [
    'changeId',
    'compositionDigest',
    'reportDigest',
    'policyDigest',
    'intentDigest',
    'evidenceBundleIds',
    'changeBranch',
    'businessDeliveries',
    'businessSplitReason',
    'plan',
  ];
  return compared.filter(
    (field) => canonicalJson(expected[field]) !== canonicalJson(current[field]),
  );
}

export function initialDeliveryStateV3(changeId: string, timestamp: string): DeliveryStateV3 {
  if (!CHANGE_ID.test(changeId)) throw new Error('Delivery change id is invalid');
  return {
    schemaVersion: 3,
    changeId,
    stateVersion: 0,
    status: 'development',
    snapshot: null,
    decisionRequest: null,
    approval: null,
    actionResults: [],
    businessMergeRequests: [],
    mergeEvidence: [],
    closure: null,
    finalChangeMergeRequest: null,
    platformCapabilities: [],
    updatedAt: timestamp,
  };
}

export function requestDeliveryApprovalV3(
  state: DeliveryStateV3,
  snapshot: DeliverySnapshotV3,
  timestamp: string,
  requestId: string = randomUUID(),
): DeliveryStateV3 {
  if (state.changeId !== snapshot.changeId) throw new Error('Cross-change snapshot rejected');
  const replacePendingRequest =
    state.status === 'awaiting_approval' &&
    state.approval === null &&
    state.actionResults.every((result) => result.status === 'pending' && result.attempts === 0);
  if (
    !replacePendingRequest &&
    !['development', 'verification_required', 'rejected'].includes(state.status)
  ) {
    throw new Error(`Approval cannot be requested from ${state.status}`);
  }
  const request: HumanDecisionRequestV3 = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    requestId,
    decisionType: 'delivery-approval',
    changeId: state.changeId,
    snapshotDigest: snapshot.digest,
    reportDigest: snapshot.reportDigest,
    evidenceBundleIds: [...snapshot.evidenceBundleIds],
    changeBranch: structuredClone(snapshot.changeBranch),
    businessDeliveries: snapshot.businessDeliveries.map(
      ({ deliveryId, repositoryId, repositoryName, sourceBranch, targetBranch }) => ({
        deliveryId,
        repositoryId,
        repositoryName,
        sourceBranch,
        targetBranch,
      }),
    ),
    businessSplitReason: snapshot.businessSplitReason
      ? structuredClone(snapshot.businessSplitReason)
      : null,
    actions: snapshot.plan.map(({ actionId, type, deliveryId, repositoryId }) => ({
      actionId,
      type,
      deliveryId,
      repositoryId,
    })),
    options: ['approve', 'request_changes', 'reject'],
  };
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: 'awaiting_approval',
    snapshot,
    decisionRequest: request,
    approval: null,
    actionResults: snapshot.plan.map(({ actionId }) => ({
      actionId,
      status: 'pending',
      attempts: 0,
    })),
    businessMergeRequests: snapshot.businessDeliveries.map(
      ({ deliveryId, repositoryId, remoteIdentity, sourceBranch, targetBranch }) => {
        if (!remoteIdentity) {
          throw new Error(`Business delivery has no remote identity: ${deliveryId}`);
        }
        return {
          deliveryId,
          repositoryId,
          remoteIdentity,
          sourceBranch,
          targetBranch,
          mergeRequest: null,
        };
      },
    ),
    mergeEvidence: [],
    closure: null,
    finalChangeMergeRequest: null,
    platformCapabilities: [],
    updatedAt: timestamp,
  };
}

export function recordHumanDecisionV3(
  state: DeliveryStateV3,
  response: HumanDecisionResponse,
  actor: TrustedActor,
  timestamp: string,
): DeliveryStateV3 {
  const request = state.decisionRequest;
  if (state.status !== 'awaiting_approval' || !request || !state.snapshot) {
    throw new Error('Delivery is not awaiting approval');
  }
  if (!actor.subject || !actor.provider || !actor.sessionId) {
    throw new Error('Trusted actor context is incomplete');
  }
  if (
    response.apiVersion !== 'repoctopus/v1alpha1' ||
    response.kind !== 'HumanDecisionResponse' ||
    response.requestId !== request.requestId ||
    response.snapshotDigest !== request.snapshotDigest ||
    !request.options.includes(response.decision)
  ) {
    throw new Error('Decision does not match the pending snapshot');
  }
  const approval: ApprovalRecord = {
    schemaVersion: 1,
    requestId: request.requestId,
    changeId: state.changeId,
    snapshotDigest: state.snapshot.digest,
    decision: response.decision,
    actor: structuredClone(actor),
    decidedAt: timestamp,
    ...(response.comment ? { comment: response.comment } : {}),
  };
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: response.decision === 'approve' ? 'approved' : 'rejected',
    approval,
    updatedAt: timestamp,
  };
}

export function invalidateDeliveryApprovalV3(
  state: DeliveryStateV3,
  timestamp: string,
): DeliveryStateV3 {
  if (!state.approval) return state;
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: 'verification_required',
    approval: null,
    decisionRequest: null,
    updatedAt: timestamp,
  };
}
