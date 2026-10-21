import type { FinalMergeRequestPort, MergeRequestInput } from './ports.js';
import {
  assertPostMergePublicationReceiptV2,
  assertPostMergePublicationRequestV2,
  createPostMergePublicationReceiptV2,
  type PostMergeDeliveryGitPortV2,
  type PostMergePublicationReceiptV2,
  type PostMergePublicationRequestV2,
} from './post-merge.js';
import type { MergeRequestIdentity, MergeRequestStatus } from './types.js';

function sameIdentity(left: MergeRequestIdentity, right: MergeRequestIdentity): boolean {
  return (
    left.provider === right.provider &&
    left.repositoryId === right.repositoryId &&
    left.number === right.number &&
    left.url === right.url
  );
}

function assertFinalMergeRequestStatus(
  status: MergeRequestStatus,
  identity: MergeRequestIdentity,
  input: MergeRequestInput,
  expectedHead: string,
): void {
  if (!sameIdentity(status, identity)) {
    throw new Error('Final Change MR identity drifted during publication');
  }
  if (status.state !== 'open') {
    throw new Error(`Equivalent final Change MR is not open: ${status.state}`);
  }
  if (status.sourceBranch !== input.sourceBranch || status.targetBranch !== input.targetBranch) {
    throw new Error('Final Change MR head/base mapping drifted');
  }
  if (status.headCommit !== expectedHead) {
    throw new Error('Final Change MR head commit drifted');
  }
  if (status.title === undefined || status.body === undefined) {
    throw new Error('Final Change MR did not report editable metadata');
  }
}

/**
 * Publishes the already audited closure commit before creating any final Change MR.
 * Intent persistence belongs to the caller/Closure Journal; this service owns the
 * idempotent external side effects and returns the receipt that the caller persists.
 */
export class FinalChangePublicationService {
  constructor(
    private readonly git: PostMergeDeliveryGitPortV2,
    private readonly mergeRequests: FinalMergeRequestPort,
  ) {}

  async publish(request: PostMergePublicationRequestV2): Promise<PostMergePublicationReceiptV2> {
    assertPostMergePublicationRequestV2(request);
    const changeBranch = request.targetMerge.intent.changeBranch;

    const git = await this.git.publishFinalChange({
      workspaceRoot: request.workspaceRoot,
      changeBranch,
      targetMergeIntent: request.targetMerge.intent,
      targetMergeReceipt: request.targetMerge.receipt,
      baseline: request.baseline,
      audit: request.audit,
      policy: request.policy,
    });
    if (git.commitOid !== git.remoteOid) {
      throw new Error('Final Change branch publication was not verified');
    }

    const input: MergeRequestInput = {
      repositoryId: changeBranch.repositoryId,
      remoteIdentity: changeBranch.remoteIdentity,
      sourceBranch: changeBranch.sourceBranch,
      targetBranch: changeBranch.targetBranch,
      title: request.policy.mergeRequest.title,
      body: request.policy.mergeRequest.body,
    };
    const matches = await this.mergeRequests.findAll(input);
    if (matches.length > 1) {
      throw new Error('Multiple final Change MRs match the approved head/base mapping');
    }

    const recovered = matches.length === 1;
    let mergeRequest = matches[0] ?? (await this.mergeRequests.create(input));
    if (mergeRequest.repositoryId !== changeBranch.repositoryId) {
      throw new Error('Final Change MR belongs to another repository');
    }

    let status = await this.mergeRequests.status(mergeRequest);
    assertFinalMergeRequestStatus(status, mergeRequest, input, git.commitOid);
    if (status.title !== input.title || status.body !== input.body) {
      const updated = await this.mergeRequests.update(mergeRequest, input);
      if (!sameIdentity(updated, mergeRequest)) {
        throw new Error('Final Change MR metadata update replaced its identity');
      }
      mergeRequest = updated;
      status = await this.mergeRequests.status(mergeRequest);
      assertFinalMergeRequestStatus(status, mergeRequest, input, git.commitOid);
      if (status.title !== input.title || status.body !== input.body) {
        throw new Error('Final Change MR metadata update could not be verified');
      }
    }

    const receipt = createPostMergePublicationReceiptV2({
      request,
      git,
      mergeRequest,
      mergeRequestRecovered: recovered,
    });
    assertPostMergePublicationReceiptV2(receipt, request);
    return receipt;
  }
}
