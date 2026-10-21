import { createHash } from 'node:crypto';

import type { PostMergeClosureAudit, PostMergeWorkspaceBaseline } from '../post-merge/closure.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { DeliveryChangeMergeRequestIntent, MergeRequestIdentity } from './types.js';

export const POST_MERGE_PUBLICATION_OPERATIONS = [
  'commit',
  'push',
  'merge_request.update',
] as const;

export interface PostMergePublicationPolicy {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'PostMergePublicationPolicy';
  operations: string[];
  remote: string;
  commit: {
    message: string;
    authorName: string;
    authorEmail: string;
  };
  mergeRequest: {
    title: string;
    body: string;
  };
}

export interface PostMergePublicationRequest {
  schemaVersion: 1;
  runId: string;
  changeId: string;
  workspaceRoot: string;
  baseline: PostMergeWorkspaceBaseline;
  audit: PostMergeClosureAudit;
  policy: PostMergePublicationPolicy;
}

export interface PostMergeGitPublicationInput {
  workspaceRoot: string;
  changeMergeRequest: DeliveryChangeMergeRequestIntent;
  baseline: PostMergeWorkspaceBaseline;
  audit: PostMergeClosureAudit;
  policy: PostMergePublicationPolicy;
}

export interface PostMergeGitPublicationResult {
  commitOid: string;
  remoteOid: string;
  commitRecovered: boolean;
  pushRecovered: boolean;
}

export interface PostMergePublicationReceipt extends PostMergeGitPublicationResult {
  schemaVersion: 1;
  runId: string;
  changeId: string;
  auditDigest: `sha256:${string}`;
  mergeRequest: MergeRequestIdentity;
  mergeRequestRecovered: boolean;
  digest: `sha256:${string}`;
}

export interface PostMergeDeliveryGitPort {
  publishPostMerge(input: PostMergeGitPublicationInput): Promise<PostMergeGitPublicationResult>;
}

export function postMergePublicationPolicyFindings(value: unknown): string[] {
  const policy = value as Partial<PostMergePublicationPolicy> | null;
  const findings: string[] = [];
  if (
    !policy ||
    policy.apiVersion !== 'repoctopus/v1alpha1' ||
    policy.kind !== 'PostMergePublicationPolicy'
  ) {
    return ['invalid-policy-header'];
  }
  const operations = Array.isArray(policy.operations) ? policy.operations : [];
  if (
    operations.length !== POST_MERGE_PUBLICATION_OPERATIONS.length ||
    new Set(operations).size !== operations.length ||
    canonicalJson([...operations].sort()) !==
      canonicalJson([...POST_MERGE_PUBLICATION_OPERATIONS].sort())
  ) {
    findings.push('forbidden-or-incomplete-operations');
  }
  if (!policy.remote || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(policy.remote)) {
    findings.push('invalid-remote');
  }
  if (
    !policy.commit?.message?.trim() ||
    policy.commit.message.includes('\n') ||
    !policy.commit.authorName?.trim() ||
    policy.commit.authorName.includes('\n') ||
    !policy.commit.authorEmail?.trim() ||
    policy.commit.authorEmail.includes('\n')
  ) {
    findings.push('invalid-commit-identity');
  }
  if (!policy.mergeRequest?.title?.trim() || !policy.mergeRequest?.body?.trim()) {
    findings.push('invalid-merge-request-update');
  }
  return findings;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function assertPostMergePublicationRequest(request: PostMergePublicationRequest): void {
  const { digest: baselineDigest, ...unsignedBaseline } = request.baseline;
  const { digest: auditDigest, ...unsignedAudit } = request.audit;
  const findings = postMergePublicationPolicyFindings(request.policy);
  if (
    request.schemaVersion !== 1 ||
    !request.runId.trim() ||
    !request.changeId.trim() ||
    !request.workspaceRoot.trim() ||
    digest(unsignedBaseline) !== baselineDigest ||
    digest(unsignedAudit) !== auditDigest ||
    request.audit.baselineDigest !== baselineDigest ||
    request.audit.changedFiles.length === 0 ||
    new Set(request.audit.changedFiles).size !== request.audit.changedFiles.length ||
    canonicalJson([...request.audit.changedFiles].sort()) !==
      canonicalJson(request.audit.changedFiles) ||
    canonicalJson(Object.keys(request.audit.contentDigests).sort()) !==
      canonicalJson(request.audit.changedFiles) ||
    Object.values(request.audit.contentDigests).some(
      (value) => !/^sha256:[a-f0-9]{64}$/u.test(value),
    ) ||
    findings.length > 0
  ) {
    throw new Error(
      `Invalid post-merge publication request${findings.length > 0 ? `: ${findings.join(', ')}` : ''}`,
    );
  }
}

export function createPostMergePublicationReceipt(input: {
  request: PostMergePublicationRequest;
  git: PostMergeGitPublicationResult;
  mergeRequest: MergeRequestIdentity;
  mergeRequestRecovered: boolean;
}): PostMergePublicationReceipt {
  const base = {
    schemaVersion: 1 as const,
    runId: input.request.runId,
    changeId: input.request.changeId,
    auditDigest: input.request.audit.digest,
    commitOid: input.git.commitOid,
    remoteOid: input.git.remoteOid,
    commitRecovered: input.git.commitRecovered,
    pushRecovered: input.git.pushRecovered,
    mergeRequest: structuredClone(input.mergeRequest),
    mergeRequestRecovered: input.mergeRequestRecovered,
  };
  return {
    ...base,
    digest: digest(base),
  };
}

export function assertPostMergePublicationReceipt(
  receipt: PostMergePublicationReceipt,
  request: PostMergePublicationRequest,
): void {
  const { digest: receiptDigest, ...unsigned } = receipt;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.runId !== request.runId ||
    receipt.changeId !== request.changeId ||
    receipt.auditDigest !== request.audit.digest ||
    receipt.commitOid !== receipt.remoteOid ||
    !/^[a-f0-9]{40,64}$/u.test(receipt.commitOid) ||
    digest(unsigned) !== receiptDigest
  ) {
    throw new Error('Post-merge publication receipt identity is invalid');
  }
}
