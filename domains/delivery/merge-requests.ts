import type {
  BusinessMergeRequestRecordV3,
  DeliveryIntent,
  DeliveryMergeRequestMatch,
  DeliveryMergeRequestSet,
  DeliveryRepositoryFacts,
  DeliveryState,
  DeliveryStateV3,
  MergeRequestIdentity,
  MergeRequestReference,
} from './types.js';

export function recordBusinessMergeRequestV3(
  current: readonly BusinessMergeRequestRecordV3[],
  deliveryId: string,
  mergeRequest: MergeRequestIdentity,
): BusinessMergeRequestRecordV3[] {
  const selected = current.find((item) => item.deliveryId === deliveryId);
  if (!selected) throw new Error(`Business merge request is not declared: ${deliveryId}`);
  if (selected.repositoryId !== mergeRequest.repositoryId) {
    throw new Error(`Business merge request repository drifted: ${deliveryId}`);
  }
  if (
    selected.mergeRequest &&
    (selected.mergeRequest.provider !== mergeRequest.provider ||
      selected.mergeRequest.repositoryId !== mergeRequest.repositoryId ||
      selected.mergeRequest.number !== mergeRequest.number ||
      selected.mergeRequest.url !== mergeRequest.url)
  ) {
    throw new Error(`Business merge request identity drifted: ${deliveryId}`);
  }
  return current.map((item) =>
    item.deliveryId === deliveryId
      ? { ...item, mergeRequest: structuredClone(mergeRequest) }
      : structuredClone(item),
  );
}

const ACTIVE_STATUSES = new Set<DeliveryState['status']>([
  'publishing',
  'partially_published',
  'in_review',
]);
const RECOVERY_STATUSES = new Set<DeliveryState['status']>(['merged']);

export function createDeliveryMergeRequestSet(
  intent: DeliveryIntent,
  repositories: readonly DeliveryRepositoryFacts[],
): DeliveryMergeRequestSet {
  const facts = new Map(repositories.map((repository) => [repository.repositoryId, repository]));
  const business = [...intent.repositories]
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId))
    .map((repository) => {
      const fact = facts.get(repository.repositoryId);
      if (!fact) throw new Error(`Selected repository is missing: ${repository.repositoryId}`);
      if (!fact.remoteIdentity)
        throw new Error(`Business repository has no remote identity: ${repository.repositoryId}`);
      if (
        fact.remoteIdentity === intent.changeMergeRequest.remoteIdentity &&
        repository.sourceBranch === intent.changeMergeRequest.sourceBranch &&
        repository.targetBranch === intent.changeMergeRequest.targetBranch
      ) {
        throw new Error(
          `Change and business roles cannot use the same source and target branches: ${repository.repositoryId}`,
        );
      }
      return {
        role: 'business' as const,
        repositoryId: repository.repositoryId,
        remoteIdentity: fact.remoteIdentity,
        sourceBranch: repository.sourceBranch,
        targetBranch: repository.targetBranch,
        mergeRequest: null,
      };
    });
  return {
    change: {
      role: 'change',
      repositoryId: intent.changeMergeRequest.repositoryId,
      remoteIdentity: intent.changeMergeRequest.remoteIdentity,
      sourceBranch: intent.changeMergeRequest.sourceBranch,
      targetBranch: intent.changeMergeRequest.targetBranch,
      mergeRequest: structuredClone(intent.changeMergeRequest.mergeRequest),
    },
    business,
  };
}

export function recordBusinessMergeRequest(
  current: DeliveryMergeRequestSet,
  repositoryId: string,
  mergeRequest: MergeRequestIdentity,
): DeliveryMergeRequestSet {
  const selected = current.business.find((item) => item.repositoryId === repositoryId);
  if (!selected) throw new Error(`Business merge request is not declared: ${repositoryId}`);
  if (mergeRequest.repositoryId !== repositoryId)
    throw new Error(`Merge request repository mismatch: ${repositoryId}`);
  const changeMergeRequest = current.change.mergeRequest;
  if (
    changeMergeRequest.provider === mergeRequest.provider &&
    changeMergeRequest.repositoryId === mergeRequest.repositoryId &&
    changeMergeRequest.number === mergeRequest.number
  ) {
    throw new Error(`Change and business roles cannot use the same merge request: ${repositoryId}`);
  }
  if (
    selected.mergeRequest &&
    (selected.mergeRequest.provider !== mergeRequest.provider ||
      selected.mergeRequest.number !== mergeRequest.number ||
      selected.mergeRequest.url !== mergeRequest.url)
  ) {
    throw new Error(`Business merge request identity drifted: ${repositoryId}`);
  }
  return {
    change: structuredClone(current.change),
    business: current.business.map((item) =>
      item.repositoryId === repositoryId
        ? { ...item, mergeRequest: structuredClone(mergeRequest) }
        : structuredClone(item),
    ),
  };
}

function matches(
  state: DeliveryState,
  reference: MergeRequestReference,
  statuses: ReadonlySet<DeliveryState['status']>,
): boolean {
  if (!statuses.has(state.status) || !state.mergeRequests) return false;
  return state.mergeRequests.business.some(
    (item) =>
      item.remoteIdentity === reference.remoteIdentity &&
      item.mergeRequest?.provider === reference.provider &&
      item.mergeRequest.number === reference.number,
  );
}

export function matchActiveDeliveryMergeRequest(
  states: readonly DeliveryState[],
  reference: MergeRequestReference,
): DeliveryMergeRequestMatch {
  const active = states.filter((state) => matches(state, reference, ACTIVE_STATUSES));
  // A merged Delivery remains recoverable if the process stopped between recording merge facts
  // and starting/completing its Post-merge Run. It must not compete with a newer active Delivery.
  const candidates =
    active.length > 0
      ? active
      : states.filter((state) => matches(state, reference, RECOVERY_STATUSES));
  const changeIds = candidates.map((state) => state.changeId).sort();
  if (changeIds.length === 0)
    return { status: 'not_found', changeIds: [], diagnostic: 'delivery-event-no-match' };
  if (changeIds.length > 1)
    return {
      status: 'ambiguous',
      changeIds,
      diagnostic: 'delivery-event-ambiguous-match',
    };
  return { status: 'matched', changeIds: [changeIds[0]!], diagnostic: null };
}

function matchesV3(
  state: DeliveryStateV3,
  reference: MergeRequestReference,
  statuses: ReadonlySet<DeliveryStateV3['status']>,
): boolean {
  if (!statuses.has(state.status)) return false;
  return state.businessMergeRequests.some(
    (item) =>
      item.remoteIdentity === reference.remoteIdentity &&
      item.mergeRequest?.provider === reference.provider &&
      item.mergeRequest.number === reference.number,
  );
}

export function matchActiveDeliveryMergeRequestV3(
  states: readonly DeliveryStateV3[],
  reference: MergeRequestReference,
): DeliveryMergeRequestMatch {
  const active = states.filter((state) => matchesV3(state, reference, ACTIVE_STATUSES));
  const candidates =
    active.length > 0
      ? active
      : states.filter((state) => matchesV3(state, reference, RECOVERY_STATUSES));
  const changeIds = candidates.map((state) => state.changeId).sort();
  if (changeIds.length === 0) {
    return { status: 'not_found', changeIds: [], diagnostic: 'delivery-event-no-match' };
  }
  if (changeIds.length > 1) {
    return {
      status: 'ambiguous',
      changeIds,
      diagnostic: 'delivery-event-ambiguous-match',
    };
  }
  return { status: 'matched', changeIds: [changeIds[0]!], diagnostic: null };
}
