import type {
  BusinessSplitReasonV3,
  DeliveryState,
  MergeRequestIdentity,
  MergeRequestStatus,
} from './types.js';

const GIT_OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

export type DeliveryV2MigrationStatus =
  | 'reprepare_required'
  | 'manual_decision_required'
  | 'repair_required';

export interface DeliveryV3MigrationDraft {
  schemaVersion: 3;
  changeId: string;
  changeBranch: {
    repositoryId: string;
    remoteIdentity: string;
    sourceBranch: string;
    targetBranch: string;
    remoteOid: string | null;
  } | null;
  businessDeliveries: Array<{
    deliveryId: string;
    repositoryId: string;
    sourceBranch: string;
    targetBranch: string;
    commitMessage: null;
    actions: Array<'push' | 'merge_request'>;
    recordedHead: string;
    recordedRemoteSourceOid: string | null;
    recordedTargetOid: string;
    legacyMergeRequest: MergeRequestIdentity | null;
  }>;
  businessSplitReason: (Omit<BusinessSplitReasonV3, 'summary'> & { summary: null }) | null;
  missingFields: string[];
}

export interface DeliveryV2MigrationPlan {
  schemaVersion: 1;
  kind: 'DeliveryV2MigrationPlan';
  changeId: string;
  source: {
    schemaVersion: 2;
    stateVersion: number;
    status: DeliveryState['status'];
    snapshotDigest: string | null;
    updatedAt: string;
  };
  status: DeliveryV2MigrationStatus;
  diagnostic:
    | 'delivery-v2-reprepare-required'
    | 'delivery-v2-open-change-merge-request'
    | 'delivery-v2-change-merge-request-repair-required';
  legacyChangeMergeRequest: {
    identity: MergeRequestIdentity;
    state: MergeRequestStatus['state'];
    headCommit: string | null;
    mergeCommit: string | null;
    mergedAt: string | null;
  } | null;
  draft: DeliveryV3MigrationDraft | null;
  approval: {
    reuseLegacyApproval: false;
    reuseLegacyEvidenceBundles: false;
    planningApprovalRequired: true;
    deliveryApprovalRequired: true;
  };
  platformMutations: [];
  requiredActions: string[];
}

function sameIdentity(left: MergeRequestIdentity, right: MergeRequestIdentity): boolean {
  return (
    left.provider === right.provider &&
    left.repositoryId === right.repositoryId &&
    left.number === right.number &&
    left.url === right.url
  );
}

function hasNoRemotePublicationActions(state: DeliveryState): boolean {
  return (
    ['development', 'verification_required', 'awaiting_approval', 'approved', 'rejected'].includes(
      state.status,
    ) &&
    state.actionResults.every(
      (action) =>
        action.status === 'pending' &&
        action.attempts === 0 &&
        !action.remoteOid &&
        !action.mergeRequest,
    ) &&
    state.mergeEvidence.length === 0
  );
}

function migrationDraft(
  state: DeliveryState,
  status: MergeRequestStatus,
): DeliveryV3MigrationDraft | null {
  const snapshot = state.snapshot;
  const change = state.mergeRequests?.change;
  if (!snapshot || !change) return null;

  const mappingMatches =
    sameIdentity(status, change.mergeRequest) &&
    status.sourceBranch === change.sourceBranch &&
    status.targetBranch === change.targetBranch;
  const remoteOid =
    mappingMatches && status.headCommit && GIT_OID.test(status.headCommit)
      ? status.headCommit
      : null;
  const repositories = [...snapshot.repositories].sort(
    (left, right) =>
      left.repositoryId.localeCompare(right.repositoryId) ||
      left.sourceBranch.localeCompare(right.sourceBranch) ||
      left.targetBranch.localeCompare(right.targetBranch),
  );
  const multiple = repositories.length > 1;
  const businessDeliveries = repositories.map((repository, index) => {
    const legacyMergeRequest = state.mergeRequests!.business.find(
      (item) =>
        item.repositoryId === repository.repositoryId &&
        item.sourceBranch === repository.sourceBranch &&
        item.targetBranch === repository.targetBranch,
    )?.mergeRequest;
    const actions = snapshot.plan
      .filter((action) => action.repositoryId === repository.repositoryId)
      .flatMap((action) =>
        action.type === 'git.push'
          ? (['push'] as const)
          : action.type === 'mr.create_or_update'
            ? (['merge_request'] as const)
            : [],
      );
    return {
      deliveryId: multiple ? `legacy-${String(index + 1).padStart(2, '0')}` : 'primary',
      repositoryId: repository.repositoryId,
      sourceBranch: repository.sourceBranch,
      targetBranch: repository.targetBranch,
      commitMessage: null,
      actions: [...new Set(actions)],
      recordedHead: repository.head,
      recordedRemoteSourceOid: repository.remoteSourceOid,
      recordedTargetOid: repository.remoteTargetOid,
      legacyMergeRequest: legacyMergeRequest ? structuredClone(legacyMergeRequest) : null,
    };
  });
  const missingFields = businessDeliveries.map(
    (delivery) => `businessDeliveries.${delivery.deliveryId}.commitMessage`,
  );
  for (const delivery of businessDeliveries) {
    if (!delivery.actions.includes('push') || !delivery.actions.includes('merge_request')) {
      missingFields.push(`businessDeliveries.${delivery.deliveryId}.actions`);
    }
    if (!delivery.legacyMergeRequest) {
      missingFields.push(`businessDeliveries.${delivery.deliveryId}.legacyMergeRequest`);
    }
  }
  if (!remoteOid) missingFields.push('changeBranch.remoteOid');
  if (multiple) missingFields.push('businessSplitReason.summary');

  return {
    schemaVersion: 3,
    changeId: state.changeId,
    changeBranch: {
      repositoryId: change.repositoryId,
      remoteIdentity: change.remoteIdentity,
      sourceBranch: change.sourceBranch,
      targetBranch: change.targetBranch,
      remoteOid,
    },
    businessDeliveries,
    businessSplitReason: multiple
      ? {
          kind:
            new Set(repositories.map((repository) => repository.repositoryId)).size ===
            repositories.length
              ? 'multi_repository'
              : 'ordered_delivery',
          summary: null,
        }
      : null,
    missingFields,
  };
}

export function createDeliveryV2MigrationPlan(
  state: DeliveryState,
  changeMergeRequestStatus: MergeRequestStatus | null,
): DeliveryV2MigrationPlan {
  const source = {
    schemaVersion: 2 as const,
    stateVersion: state.stateVersion,
    status: state.status,
    snapshotDigest: state.snapshot?.digest ?? null,
    updatedAt: state.updatedAt,
  };
  const common = {
    schemaVersion: 1 as const,
    kind: 'DeliveryV2MigrationPlan' as const,
    changeId: state.changeId,
    source,
    approval: {
      reuseLegacyApproval: false as const,
      reuseLegacyEvidenceBundles: false as const,
      planningApprovalRequired: true as const,
      deliveryApprovalRequired: true as const,
    },
    platformMutations: [] as [],
  };

  const reprepare = (options: {
    legacyChangeMergeRequest: DeliveryV2MigrationPlan['legacyChangeMergeRequest'];
    draft: DeliveryV3MigrationDraft | null;
    resolveLegacyMergeRequest: boolean;
  }): DeliveryV2MigrationPlan => ({
    ...common,
    status: 'reprepare_required',
    diagnostic: 'delivery-v2-reprepare-required',
    legacyChangeMergeRequest: options.legacyChangeMergeRequest,
    draft: options.draft,
    requiredActions: [
      ...(options.resolveLegacyMergeRequest
        ? ['decide-whether-to-retain-or-close-legacy-change-merge-request']
        : []),
      ...(options.draft ? ['complete-v3-draft-fields'] : ['create-delivery-intent-v3']),
      ...(options.draft?.changeBranch?.remoteOid ? [] : ['publish-change-branch']),
      'validate-specification',
      'obtain-new-planning-approval',
      'obtain-new-delivery-approval',
    ],
  });

  if (hasNoRemotePublicationActions(state) && !state.mergeRequests?.change) {
    return reprepare({
      legacyChangeMergeRequest: null,
      draft: null,
      resolveLegacyMergeRequest: false,
    });
  }

  const change = state.mergeRequests?.change;
  if (!change || !changeMergeRequestStatus) {
    return {
      ...common,
      status: 'repair_required',
      diagnostic: 'delivery-v2-change-merge-request-repair-required',
      legacyChangeMergeRequest: null,
      draft: null,
      requiredActions: [
        'recover-legacy-change-merge-request-facts',
        'create-delivery-intent-v3',
        'obtain-new-planning-approval',
        'obtain-new-delivery-approval',
      ],
    };
  }

  const mappingMatches =
    sameIdentity(changeMergeRequestStatus, change.mergeRequest) &&
    changeMergeRequestStatus.sourceBranch === change.sourceBranch &&
    changeMergeRequestStatus.targetBranch === change.targetBranch &&
    !!changeMergeRequestStatus.headCommit &&
    GIT_OID.test(changeMergeRequestStatus.headCommit);
  const legacyChangeMergeRequest = {
    identity: structuredClone(change.mergeRequest),
    state: changeMergeRequestStatus.state,
    headCommit: changeMergeRequestStatus.headCommit ?? null,
    mergeCommit: changeMergeRequestStatus.mergeCommit,
    mergedAt: changeMergeRequestStatus.mergedAt,
  };
  const draft = migrationDraft(state, changeMergeRequestStatus);

  if (
    changeMergeRequestStatus.state === 'open' &&
    mappingMatches &&
    hasNoRemotePublicationActions(state)
  ) {
    return reprepare({
      legacyChangeMergeRequest,
      draft,
      resolveLegacyMergeRequest: true,
    });
  }

  if (changeMergeRequestStatus.state === 'open' && mappingMatches) {
    return {
      ...common,
      status: 'manual_decision_required',
      diagnostic: 'delivery-v2-open-change-merge-request',
      legacyChangeMergeRequest,
      draft,
      requiredActions: [
        'decide-whether-to-retain-or-close-legacy-change-merge-request',
        'complete-v3-draft-fields',
        'validate-specification',
        'obtain-new-planning-approval',
        'obtain-new-delivery-approval',
      ],
    };
  }

  return {
    ...common,
    status: 'repair_required',
    diagnostic: 'delivery-v2-change-merge-request-repair-required',
    legacyChangeMergeRequest,
    draft,
    requiredActions: [
      'inspect-legacy-change-merge-request-and-target-baseline',
      'complete-v3-draft-fields',
      'validate-specification',
      'obtain-new-planning-approval',
      'obtain-new-delivery-approval',
    ],
  };
}
