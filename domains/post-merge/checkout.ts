import { createHash } from 'node:crypto';

import type { PostMergeRepositoryFact } from './coordinator.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

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
