import { createHash } from 'node:crypto';

import type {
  DeliveryMergeRequestRefresh,
  DeliveryMergeRequestRefreshV3,
  MergeEvidence,
} from '../delivery/types.js';
import type { ChangeBranchReference } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export type PostMergeCoordinationResult =
  | {
      status: 'ignored';
      diagnostic: 'delivery-event-no-match';
      changeIds: [];
    }
  | {
      status: 'ambiguous';
      diagnostic: 'delivery-event-ambiguous-match';
      changeIds: string[];
    }
  | {
      status: 'waiting';
      diagnostic:
        | 'post-merge-business-merge-requests-incomplete'
        | 'post-merge-business-merge-requests-open';
      changeId: string;
      mergedCount: number;
      totalCount: number;
    }
  | {
      status: 'blocked';
      diagnostic: 'post-merge-business-merge-request-closed' | 'post-merge-merge-facts-incomplete';
      changeId: string;
      repositoryIds: string[];
    }
  | {
      status: 'ready';
      diagnostic: 'post-merge-ready';
      changeId: string;
      mergeFactsDigest: `sha256:${string}`;
      changeBranch?: ChangeBranchReference;
      mergeEvidence: MergeEvidence[];
      repositories: PostMergeRepositoryFact[];
    };

export interface PostMergeRepositoryFact {
  repositoryId: string;
  remoteIdentity: string;
  targetBranch: string;
  mergeCommit: string;
}

function identityKey(identity: { provider: string; repositoryId: string; number: number }): string {
  return `${identity.provider}\0${identity.repositoryId}\0${identity.number}`;
}

function mergeFactsDigest(refresh: DeliveryMergeRequestRefresh): `sha256:${string}` {
  const state = refresh.state!;
  const evidence = new Map(
    state.mergeEvidence.map((item) => [identityKey(item.mergeRequest), item] as const),
  );
  const facts = state
    .mergeRequests!.business.map((item) => {
      const mergeRequest = item.mergeRequest!;
      const merged = evidence.get(identityKey(mergeRequest))!;
      return {
        repositoryId: item.repositoryId,
        remoteIdentity: item.remoteIdentity,
        targetBranch: item.targetBranch,
        mergeRequest,
        mergeCommit: merged.mergeCommit,
        mergedAt: merged.mergedAt,
      };
    })
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  return `sha256:${createHash('sha256').update(canonicalJson(facts)).digest('hex')}`;
}

function coordinatePostMergeV3(
  refresh: DeliveryMergeRequestRefreshV3,
): PostMergeCoordinationResult {
  const state = refresh.state!;
  const totalCount = state.businessMergeRequests.length;
  const declaredIdentities = state.businessMergeRequests.flatMap((item) =>
    item.mergeRequest ? [item.mergeRequest] : [],
  );
  const statuses = new Map(
    refresh.mergeRequestStatuses.map((item) => [identityKey(item), item] as const),
  );
  const closed = declaredIdentities
    .filter((item) => statuses.get(identityKey(item))?.state === 'closed')
    .map((item) => item.repositoryId)
    .sort();
  if (closed.length > 0) {
    return {
      status: 'blocked',
      diagnostic: 'post-merge-business-merge-request-closed',
      changeId: state.changeId,
      repositoryIds: closed,
    };
  }
  const mergedCount = declaredIdentities.filter(
    (item) => statuses.get(identityKey(item))?.state === 'merged',
  ).length;
  if (
    declaredIdentities.length !== totalCount ||
    statuses.size !== totalCount ||
    declaredIdentities.some((identity) => !statuses.has(identityKey(identity)))
  ) {
    return {
      status: 'waiting',
      diagnostic: 'post-merge-business-merge-requests-incomplete',
      changeId: state.changeId,
      mergedCount,
      totalCount,
    };
  }
  if (mergedCount !== totalCount) {
    return {
      status: 'waiting',
      diagnostic: 'post-merge-business-merge-requests-open',
      changeId: state.changeId,
      mergedCount,
      totalCount,
    };
  }
  const evidenceByIdentity = new Map(
    state.mergeEvidence.map((item) => [identityKey(item.mergeRequest), item] as const),
  );
  const incomplete = state.businessMergeRequests
    .filter((item) => !item.mergeRequest || !evidenceByIdentity.has(identityKey(item.mergeRequest)))
    .map((item) => item.repositoryId)
    .sort();
  if (incomplete.length > 0 || state.status !== 'merged' || !state.snapshot) {
    return {
      status: 'blocked',
      diagnostic: 'post-merge-merge-facts-incomplete',
      changeId: state.changeId,
      repositoryIds: incomplete,
    };
  }
  const facts = state.businessMergeRequests
    .map((item) => {
      const mergeRequest = item.mergeRequest!;
      const evidence = evidenceByIdentity.get(identityKey(mergeRequest))!;
      return {
        deliveryId: item.deliveryId,
        repositoryId: item.repositoryId,
        remoteIdentity: item.remoteIdentity,
        targetBranch: item.targetBranch,
        mergeRequest,
        mergeCommit: evidence.mergeCommit,
        mergedAt: evidence.mergedAt,
      };
    })
    .sort((left, right) => left.deliveryId.localeCompare(right.deliveryId));
  const digest: `sha256:${string}` = `sha256:${createHash('sha256')
    .update(canonicalJson({ changeBranch: state.snapshot.changeBranch, facts }))
    .digest('hex')}`;
  return {
    status: 'ready',
    diagnostic: 'post-merge-ready',
    changeId: state.changeId,
    mergeFactsDigest: digest,
    changeBranch: structuredClone(state.snapshot.changeBranch),
    mergeEvidence: structuredClone(state.mergeEvidence),
    repositories: facts.map((item) => ({
      repositoryId: item.repositoryId,
      remoteIdentity: item.remoteIdentity,
      targetBranch: item.targetBranch,
      mergeCommit: item.mergeCommit,
    })),
  };
}

export function coordinatePostMerge(
  refresh: DeliveryMergeRequestRefresh | DeliveryMergeRequestRefreshV3,
): PostMergeCoordinationResult {
  if (refresh.match.status === 'not_found') {
    return {
      status: 'ignored',
      diagnostic: refresh.match.diagnostic,
      changeIds: [],
    };
  }
  if (refresh.match.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      diagnostic: refresh.match.diagnostic,
      changeIds: [...refresh.match.changeIds],
    };
  }
  if (!refresh.state) {
    throw new Error('Matched Delivery has no state');
  }
  if (refresh.state.schemaVersion === 3) {
    return coordinatePostMergeV3(refresh as DeliveryMergeRequestRefreshV3);
  }
  const state = refresh.state;
  if (!state.mergeRequests) {
    throw new Error('Matched Delivery has no merge request set');
  }

  const mergeRequests = state.mergeRequests;
  const totalCount = mergeRequests.business.length;
  const declaredIdentities = mergeRequests.business.flatMap((item) =>
    item.mergeRequest ? [item.mergeRequest] : [],
  );
  const statuses = new Map(
    refresh.mergeRequestStatuses.map((item) => [identityKey(item), item] as const),
  );
  const closed = declaredIdentities
    .filter((identity) => statuses.get(identityKey(identity))?.state === 'closed')
    .map((identity) => identity.repositoryId)
    .sort();
  if (closed.length > 0) {
    return {
      status: 'blocked',
      diagnostic: 'post-merge-business-merge-request-closed',
      changeId: state.changeId,
      repositoryIds: closed,
    };
  }

  const mergedCount = declaredIdentities.filter(
    (identity) => statuses.get(identityKey(identity))?.state === 'merged',
  ).length;
  if (
    declaredIdentities.length !== totalCount ||
    statuses.size !== totalCount ||
    declaredIdentities.some((identity) => !statuses.has(identityKey(identity)))
  ) {
    return {
      status: 'waiting',
      diagnostic: 'post-merge-business-merge-requests-incomplete',
      changeId: state.changeId,
      mergedCount,
      totalCount,
    };
  }
  if (mergedCount !== totalCount) {
    return {
      status: 'waiting',
      diagnostic: 'post-merge-business-merge-requests-open',
      changeId: state.changeId,
      mergedCount,
      totalCount,
    };
  }

  const evidenceByIdentity = new Map(
    state.mergeEvidence.map((item) => [identityKey(item.mergeRequest), item] as const),
  );
  const incompleteFacts = mergeRequests.business
    .filter((item) => !item.mergeRequest || !evidenceByIdentity.has(identityKey(item.mergeRequest)))
    .map((item) => item.repositoryId)
    .sort();
  if (incompleteFacts.length > 0 || state.status !== 'merged') {
    return {
      status: 'blocked',
      diagnostic: 'post-merge-merge-facts-incomplete',
      changeId: state.changeId,
      repositoryIds: incompleteFacts,
    };
  }

  return {
    status: 'ready',
    diagnostic: 'post-merge-ready',
    changeId: state.changeId,
    mergeFactsDigest: mergeFactsDigest(refresh as DeliveryMergeRequestRefresh),
    mergeEvidence: structuredClone(state.mergeEvidence),
    repositories: mergeRequests.business
      .map((item) => ({
        repositoryId: item.repositoryId,
        remoteIdentity: item.remoteIdentity,
        targetBranch: item.targetBranch,
        mergeCommit: evidenceByIdentity.get(identityKey(item.mergeRequest!))!.mergeCommit,
      }))
      .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
  };
}
