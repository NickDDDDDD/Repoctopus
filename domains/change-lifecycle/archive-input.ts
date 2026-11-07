import { createHash } from 'node:crypto';

import type { ArtifactRef } from '../evidence/types.js';
import { deliveryPolicyDigest } from '../delivery/snapshot.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../delivery/types.js';
import type { ProjectSnapshot } from '../project/types.js';
import { assertDeliveryIntentV3, normalizeDeliveryIntentV3 } from '../delivery/v3.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type { EffectiveWorkSkillComposition } from '../skill/composition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';

export interface ArchiveDeliveryInput {
  schemaVersion: 3;
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
  planningCompositionDigest?: `sha256:${string}`;
  evidenceCompositionDigest?: `sha256:${string}`;
  digest: `sha256:${string}`;
  publicationCheckpoint: ArchivePublicationCheckpoint;
}

export interface ArchivePublicationCheckpoint {
  schemaVersion: 1;
  repositories: readonly {
    repositoryId: string;
    head: string;
    branch: string;
    remoteIdentity: string | null;
  }[];
  digest: `sha256:${string}`;
}

export function createArchivePublicationCheckpoint(
  project: ProjectSnapshot,
  intent: DeliveryIntentV3,
): ArchivePublicationCheckpoint {
  const routes = [
    {
      repositoryId: intent.changeBranch.repositoryId,
      sourceBranch: intent.changeBranch.sourceBranch,
    },
    ...intent.businessDeliveries,
  ];
  const byId = new Map<string, ArchivePublicationCheckpoint['repositories'][number]>();
  for (const route of routes) {
    const repo = project.repositories.find((repo) => repo.id === route.repositoryId);
    if (
      !repo ||
      repo.branch !== route.sourceBranch ||
      !/^([a-f0-9]{40}|[a-f0-9]{64})$/u.test(repo.head)
    )
      throw new Error(
        'Archive publication checkpoint requires an authorized source branch and HEAD',
      );
    const value = {
      repositoryId: repo.id,
      head: repo.head,
      branch: repo.branch,
      remoteIdentity: repo.remoteIdentity,
    };
    const old = byId.get(repo.id);
    if (old && canonicalJson(old) !== canonicalJson(value))
      throw new Error('Archive publication routes disagree');
    byId.set(repo.id, value);
  }
  const stable = {
    schemaVersion: 1 as const,
    repositories: [...byId.values()].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId)),
  };
  return { ...stable, digest: sha256(stable) };
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
  planningCompositionDigest: `sha256:${string}`;
  evidenceCompositionDigest: `sha256:${string}`;
  publicationCheckpoint: ArchivePublicationCheckpoint;
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
  const { digest: checkpointDigest, ...checkpointFacts } = input.publicationCheckpoint;
  const expectedRepositories = [
    ...new Set([
      intent.changeBranch.repositoryId,
      ...intent.businessDeliveries.map((item) => item.repositoryId),
    ]),
  ].sort();
  if (
    checkpointFacts.schemaVersion !== 1 ||
    checkpointDigest !== sha256(checkpointFacts) ||
    canonicalJson(
      input.publicationCheckpoint.repositories.map((repo) => repo.repositoryId).sort(),
    ) !== canonicalJson(expectedRepositories)
  )
    throw new Error('Archive publication checkpoint is incomplete or corrupt');
  const stable = {
    schemaVersion: 3 as const,
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
    planningCompositionDigest: input.planningCompositionDigest,
    evidenceCompositionDigest: input.evidenceCompositionDigest,
    publicationCheckpoint: structuredClone(input.publicationCheckpoint),
  };
  return { ...stable, digest: sha256(stable) };
}

export function createSpecificationCloseWork(facts: {
  definition: ChangeLifecycleDefinition;
  checkEpoch: number;
  archive: ArchiveDeliveryInput;
  actionSkill: SkillUsageSnapshot;
  skillComposition?: EffectiveWorkSkillComposition;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'specification.close',
    actionSkill: facts.actionSkill,
    augmentationSkills: [],
    ...(facts.skillComposition ? { skillComposition: facts.skillComposition } : {}),
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  return {
    schemaVersion: 2,
    workId: `archive:specification-close:${facts.archive.digest.slice('sha256:'.length, 19)}`,
    checkEpoch: facts.checkEpoch,
    ...binding,
    inputDigest: facts.archive.digest,
  };
}

export function createDeliveryPublishWork(facts: {
  definition: ChangeLifecycleDefinition;
  checkEpoch: number;
  archive: ArchiveDeliveryInput;
  closure: { closureId: `sha256:${string}`; planDigest: `sha256:${string}` };
  actionSkill: SkillUsageSnapshot;
  skillComposition?: EffectiveWorkSkillComposition;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'delivery.publish',
    actionSkill: facts.actionSkill,
    augmentationSkills: [],
    ...(facts.skillComposition ? { skillComposition: facts.skillComposition } : {}),
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const inputDigest = sha256({
    archiveInputDigest: facts.archive.digest,
    closureId: facts.closure.closureId,
    closurePlanDigest: facts.closure.planDigest,
    binding,
  });
  return {
    schemaVersion: 2,
    workId: `archive:delivery-publish:${inputDigest.slice('sha256:'.length, 19)}`,
    checkEpoch: facts.checkEpoch,
    ...binding,
    inputDigest,
  };
}
