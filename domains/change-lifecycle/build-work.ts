import { createHash } from 'node:crypto';

import type { SpecificationTask, SpecificationTaskSet } from '../specification/types.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createInitialBuildWork(facts: {
  runId: string;
  checkEpoch: number;
  definition: ChangeLifecycleDefinition;
  actionSkill: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  taskSet: SpecificationTaskSet;
  approvalHash: `sha256:${string}`;
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): { tasks: SpecificationTask[]; work: WorkDescriptor } {
  return {
    tasks: structuredClone(facts.taskSet.tasks),
    work: createBuildActionWork({
      ...facts,
      kind: 'build.configure',
      stableInput: { taskSetDigest: facts.taskSet.digest, approvalHash: facts.approvalHash },
    }),
  };
}

export function createBuildActionWork(facts: {
  runId: string;
  checkEpoch: number;
  definition: ChangeLifecycleDefinition;
  kind: 'build.configure' | 'build.plan' | 'build.execute' | 'build.check';
  actionSkill: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
  stableInput: unknown;
  configurationId?: string;
  planId?: string;
  planRevision?: number;
  packageId?: string;
  writeScopes?: readonly { repositoryId: string; paths: readonly string[] }[];
  taskId?: string;
  taskRevision?: `sha256:${string}`;
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: facts.kind,
    actionSkill: facts.actionSkill,
    augmentationSkills: [],
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const stableInput = {
    runId: facts.runId,
    checkEpoch: facts.checkEpoch,
    stableInput: facts.stableInput,
    compositionDigest: facts.compositionDigest,
    projectConfigDigest: facts.projectConfigDigest,
    projectSnapshotDigest: facts.projectSnapshotDigest,
    repositoryIds: [...facts.repositoryIds].sort(),
    binding,
  };
  const inputDigest = sha256(stableInput);
  const augmentationNames = facts.augmentationSkills.map((skill) => skill.name);
  const validAugmentations =
    facts.kind === 'build.execute'
      ? augmentationNames.length === 0 ||
        (augmentationNames.length === 1 && augmentationNames[0] === 'tdd')
      : facts.kind === 'build.check'
        ? augmentationNames.length === 1 && augmentationNames[0] === 'code-review'
        : augmentationNames.length === 0;
  if (!validAugmentations) {
    throw new Error(`Build Action augmentation Skills do not match frozen policy: ${facts.kind}`);
  }
  const writeScopes = facts.writeScopes
    ? facts.writeScopes.map((scope) => {
        if (!facts.repositoryIds.includes(scope.repositoryId) || scope.paths.length === 0) {
          throw new Error('Build Work write scope exceeds registered repositories');
        }
        return {
          repositoryId: scope.repositoryId,
          paths: [...scope.paths],
          operations: ['create', 'update', 'delete'] as const,
        };
      })
    : binding.writeScopes;
  return {
    schemaVersion: 2,
    workId: `${facts.kind}:${inputDigest.slice('sha256:'.length, 19)}`,
    checkEpoch: facts.checkEpoch,
    ...binding,
    buildAction: facts.kind.slice('build.'.length) as NonNullable<WorkDescriptor['buildAction']>,
    ...(facts.configurationId ? { configurationId: facts.configurationId } : {}),
    ...(facts.planId ? { planId: facts.planId } : {}),
    ...(facts.planRevision !== undefined ? { planRevision: facts.planRevision } : {}),
    ...(facts.packageId ? { packageId: facts.packageId } : {}),
    augmentationSkills: structuredClone(facts.augmentationSkills),
    writeScopes,
    ...(facts.taskId ? { taskId: facts.taskId } : {}),
    ...(facts.taskRevision ? { taskRevision: facts.taskRevision } : {}),
    inputDigest,
  };
}
