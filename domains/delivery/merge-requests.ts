import type {
  DeliveryIntent,
  DeliveryMergeRequestMatch,
  DeliveryMergeRequestSet,
  DeliveryRepositoryFacts,
  DeliveryState,
  MergeRequestIdentity,
  MergeRequestReference,
} from './types.js';

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
    coordination: {
      role: 'coordination',
      repositoryId: intent.coordinationMergeRequest.repositoryId,
      remoteIdentity: intent.coordinationMergeRequest.remoteIdentity,
      sourceBranch: intent.coordinationMergeRequest.sourceBranch,
      targetBranch: intent.coordinationMergeRequest.targetBranch,
      mergeRequest: structuredClone(intent.coordinationMergeRequest.mergeRequest),
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
  if (
    selected.mergeRequest &&
    (selected.mergeRequest.provider !== mergeRequest.provider ||
      selected.mergeRequest.number !== mergeRequest.number ||
      selected.mergeRequest.url !== mergeRequest.url)
  ) {
    throw new Error(`Business merge request identity drifted: ${repositoryId}`);
  }
  return {
    coordination: structuredClone(current.coordination),
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
  const changeIds = candidates
    .map((state) => state.changeId)
    .sort();
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
