import { createHash } from 'node:crypto';

import type { SkillUsageSnapshot } from '../skill/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';

export function createLifecyclePhaseWork(input: {
  runId: string;
  changeId: string;
  definition: ChangeLifecycleDefinition;
  kind: 'change.intake' | 'specification.plan';
  actionSkill: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  compositionDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  projectConfigDigest: `sha256:${string}`;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: input.definition,
    kind: input.kind,
    actionSkill: input.actionSkill,
    augmentationSkills: input.augmentationSkills,
    workspaceRepositoryId: input.workspaceRepositoryId,
    repositoryIds: input.repositoryIds,
  });
  const stable = {
    runId: input.runId,
    changeId: input.changeId,
    kind: input.kind,
    definitionId: input.definition.id,
    definitionVersion: input.definition.version,
    actionSkill: input.actionSkill,
    augmentationSkills: input.augmentationSkills,
    compositionDigest: input.compositionDigest,
    projectSnapshotDigest: input.projectSnapshotDigest,
    projectConfigDigest: input.projectConfigDigest,
  };
  const inputDigest = `sha256:${createHash('sha256')
    .update(canonicalJson(stable))
    .digest('hex')}` as const;
  return {
    schemaVersion: 1,
    workId: `${input.runId}:${input.kind}:${inputDigest.slice(-16)}`,
    ...binding,
    inputDigest,
  };
}
