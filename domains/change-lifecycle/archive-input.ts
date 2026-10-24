import { createHash } from 'node:crypto';

import type { ArtifactRef } from '../evidence/types.js';
import { deliveryPolicyDigest } from '../delivery/snapshot.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../delivery/types.js';
import type {
  ArchiveMergeRefreshResult,
  ArchivePublicationResult,
} from '../delivery/service-v3.js';
import { assertDeliveryIntentV3, normalizeDeliveryIntentV3 } from '../delivery/v3.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';

export interface ArchiveDeliveryInput {
  schemaVersion: 1;
  runId: string;
  changeId: string;
  verificationInputDigest: `sha256:${string}`;
  evidenceBundleId: string;
  verificationReport: ArtifactRef;
  changeBranch: DeliveryIntentV3['changeBranch'];
  businessDeliveries: DeliveryIntentV3['businessDeliveries'];
  businessSplitReason: DeliveryIntentV3['businessSplitReason'] | null;
  publicationPolicyDigest: string;
  actionAuthorization: 'policy';
  digest: `sha256:${string}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createArchiveDeliveryInput(input: {
  runId: string;
  changeId: string;
  verificationInputDigest: `sha256:${string}`;
  acceptedEvidenceBundleIds: readonly string[];
  evidenceBundleId: string;
  verificationReport: ArtifactRef;
  intent: DeliveryIntentV3;
  policy: DeliveryPolicy;
}): ArchiveDeliveryInput {
  assertDeliveryIntentV3(input.intent);
  if (input.intent.changeId !== input.changeId) {
    throw new Error('Archive Delivery intent belongs to another Change');
  }
  if (!input.acceptedEvidenceBundleIds.includes(input.evidenceBundleId)) {
    throw new Error('Archive Delivery requires an Evidence Bundle accepted by the Change Run');
  }
  if (
    input.verificationReport.artifactType !== 'verification-report' ||
    !input.verificationReport.redacted
  ) {
    throw new Error('Archive Delivery requires the bounded redacted verification report');
  }
  const intent = normalizeDeliveryIntentV3(input.intent);
  const stable = {
    schemaVersion: 1 as const,
    runId: input.runId,
    changeId: input.changeId,
    verificationInputDigest: input.verificationInputDigest,
    evidenceBundleId: input.evidenceBundleId,
    verificationReport: structuredClone(input.verificationReport),
    changeBranch: structuredClone(intent.changeBranch),
    businessDeliveries: structuredClone(intent.businessDeliveries),
    businessSplitReason: intent.businessSplitReason
      ? structuredClone(intent.businessSplitReason)
      : null,
    publicationPolicyDigest: deliveryPolicyDigest(input.policy),
    actionAuthorization: 'policy' as const,
  };
  return { ...stable, digest: sha256(stable) };
}

export function createArchiveDeliveryWork(facts: {
  definition: ChangeLifecycleDefinition;
  archive: ArchiveDeliveryInput;
  actionSkill: SkillUsageSnapshot;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'delivery.prepare',
    actionSkill: facts.actionSkill,
    augmentationSkills: [],
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  return {
    schemaVersion: 1,
    workId: `archive:delivery:${facts.archive.digest.slice('sha256:'.length, 19)}`,
    ...binding,
    inputDigest: facts.archive.digest,
  };
}

export function createAwaitMergeWork(facts: {
  definition: ChangeLifecycleDefinition;
  archive: ArchiveDeliveryInput;
  publication: ArchivePublicationResult;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'delivery.await-merge',
    augmentationSkills: [],
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const inputDigest = sha256({
    archiveInputDigest: facts.archive.digest,
    publicationSnapshotDigest: facts.publication.snapshot.digest,
    receipts: facts.publication.receipts,
  });
  return {
    schemaVersion: 1,
    workId: `archive:await-merge:${inputDigest.slice('sha256:'.length, 19)}`,
    ...binding,
    inputDigest,
  };
}

export function createPostMergeVerifyWork(facts: {
  definition: ChangeLifecycleDefinition;
  archive: ArchiveDeliveryInput;
  refresh: ArchiveMergeRefreshResult;
  actionSkill: SkillUsageSnapshot;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  if (!facts.refresh.allMerged || facts.refresh.mergeEvidence.length === 0) {
    throw new Error('Post-merge Verify Work requires the complete exact merge collection');
  }
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'delivery.verify-merged',
    actionSkill: facts.actionSkill,
    augmentationSkills: [],
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const inputDigest = sha256({
    archiveInputDigest: facts.archive.digest,
    mergeEvidence: facts.refresh.mergeEvidence,
    binding,
  });
  return {
    schemaVersion: 1,
    workId: `archive:verify-merged:${inputDigest.slice('sha256:'.length, 19)}`,
    ...binding,
    inputDigest,
  };
}

export function createSpecificationArchiveWork(facts: {
  definition: ChangeLifecycleDefinition;
  archive: ArchiveDeliveryInput;
  postMergeBundleId: string;
  checkoutManifestDigest: `sha256:${string}`;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'specification.archive',
    augmentationSkills: [],
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const inputDigest = sha256({
    archiveInputDigest: facts.archive.digest,
    postMergeBundleId: facts.postMergeBundleId,
    checkoutManifestDigest: facts.checkoutManifestDigest,
    binding,
  });
  return {
    schemaVersion: 1,
    workId: `archive:specification:${inputDigest.slice('sha256:'.length, 19)}`,
    ...binding,
    inputDigest,
  };
}
