import { createHash } from 'node:crypto';

import type { PostMergeRepositoryFact } from './coordinator.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeBranchReference } from '../specification/types.js';

export interface PostMergeRepositorySource {
  repositoryId: string;
  path: string;
}

export interface PostMergeCheckoutRepository extends PostMergeRepositoryFact {
  path: string;
  tree: string;
}

export interface PostMergeCheckoutManifest {
  schemaVersion: 1;
  runId: string;
  mergeFactsDigest: `sha256:${string}`;
  root: string;
  repositories: PostMergeCheckoutRepository[];
  digest: `sha256:${string}`;
}

type ManifestWithoutDigest = Omit<PostMergeCheckoutManifest, 'digest'>;

export function createPostMergeCheckoutManifest(
  value: ManifestWithoutDigest,
): PostMergeCheckoutManifest {
  const normalized: ManifestWithoutDigest = {
    ...structuredClone(value),
    repositories: [...value.repositories].sort((left, right) =>
      left.repositoryId.localeCompare(right.repositoryId),
    ),
  };
  return {
    ...normalized,
    digest: `sha256:${createHash('sha256').update(canonicalJson(normalized)).digest('hex')}`,
  };
}

export interface PostMergeCheckoutPort {
  checkout(input: {
    runId: string;
    mergeFactsDigest: `sha256:${string}`;
    temporaryRoot: string;
    repositories: PostMergeRepositoryFact[];
    sources: PostMergeRepositorySource[];
    signal?: AbortSignal;
  }): Promise<PostMergeCheckoutManifest>;
  verify(manifest: PostMergeCheckoutManifest, signal?: AbortSignal): Promise<void>;
  cleanup(manifest: PostMergeCheckoutManifest): Promise<void>;
}

export interface PostMergeTargetMergeIntent {
  schemaVersion: 1;
  runId: string;
  mergeFactsDigest: `sha256:${string}`;
  remote: string;
  changeBranch: ChangeBranchReference;
  targetOid: string;
  digest: `sha256:${string}`;
}

export interface PostMergeTargetMergeReceipt {
  schemaVersion: 1;
  intentDigest: `sha256:${string}`;
  repositoryId: string;
  sourceOid: string;
  targetOid: string;
  mergeCommitOid: string;
  parents: [string, string];
  checkoutPath: string;
  digest: `sha256:${string}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createPostMergeTargetMergeIntent(
  value: Omit<PostMergeTargetMergeIntent, 'digest'>,
): PostMergeTargetMergeIntent {
  const base = structuredClone(value);
  return { ...base, digest: sha256(base) };
}

export function assertPostMergeTargetMergeIntent(value: PostMergeTargetMergeIntent): void {
  const { digest, ...unsigned } = value;
  if (
    value.schemaVersion !== 1 ||
    !value.runId.trim() ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.mergeFactsDigest) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value.remote) ||
    !value.changeBranch.repositoryId.trim() ||
    !value.changeBranch.remoteIdentity.trim() ||
    !value.changeBranch.sourceBranch.trim() ||
    !value.changeBranch.targetBranch.trim() ||
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value.changeBranch.remoteOid) ||
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value.targetOid) ||
    value.changeBranch.sourceBranch === value.changeBranch.targetBranch ||
    sha256(unsigned) !== digest
  ) {
    throw new Error('Post-merge target merge Intent is invalid');
  }
}

export function createPostMergeTargetMergeReceipt(
  value: Omit<PostMergeTargetMergeReceipt, 'digest'>,
): PostMergeTargetMergeReceipt {
  const base = structuredClone(value);
  return { ...base, digest: sha256(base) };
}

export function assertPostMergeTargetMergeReceipt(
  receipt: PostMergeTargetMergeReceipt,
  intent: PostMergeTargetMergeIntent,
): void {
  assertPostMergeTargetMergeIntent(intent);
  const { digest, ...unsigned } = receipt;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.intentDigest !== intent.digest ||
    receipt.repositoryId !== intent.changeBranch.repositoryId ||
    receipt.sourceOid !== intent.changeBranch.remoteOid ||
    receipt.targetOid !== intent.targetOid ||
    canonicalJson(receipt.parents) !==
      canonicalJson([intent.changeBranch.remoteOid, intent.targetOid]) ||
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(receipt.mergeCommitOid) ||
    receipt.mergeCommitOid === receipt.sourceOid ||
    receipt.mergeCommitOid === receipt.targetOid ||
    !receipt.checkoutPath.trim() ||
    sha256(unsigned) !== digest
  ) {
    throw new Error('Post-merge target merge Receipt is invalid');
  }
}

export interface PostMergeChangeBranchCheckoutPort {
  prepareTargetMerge(input: {
    runId: string;
    mergeFactsDigest: `sha256:${string}`;
    remote: string;
    changeBranch: ChangeBranchReference;
    source: PostMergeRepositorySource;
  }): Promise<PostMergeTargetMergeIntent>;
  mergeTarget(input: {
    temporaryRoot: string;
    source: PostMergeRepositorySource;
    intent: PostMergeTargetMergeIntent;
    signal?: AbortSignal;
  }): Promise<PostMergeTargetMergeReceipt>;
  verifyTargetMerge(
    intent: PostMergeTargetMergeIntent,
    receipt: PostMergeTargetMergeReceipt,
    signal?: AbortSignal,
  ): Promise<void>;
}
