import { createHash } from 'node:crypto';

import type { SpecificationTask, SpecificationTaskSet } from '../specification/types.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import {
  createEffectiveWorkSkillComposition,
  type EffectiveWorkSkillComposition,
} from '../skill/composition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';
import {
  executionBindingRequiredCapabilities,
  type BuildActionKind,
  type BuildExecutionMode,
  type BuildTddMode,
} from './build-protocol.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function buildActionSkillComposition(input: {
  action: Exclude<BuildActionKind, 'plan-evidence'>;
  tddMode?: BuildTddMode;
}): { actionSkill: string; augmentationSkills: readonly string[] } {
  const augmentationSkills =
    input.action === 'execute'
      ? input.tddMode === 'tdd'
        ? ['tdd']
        : []
      : input.action === 'check'
        ? ['code-review']
        : [];
  return Object.freeze({
    actionSkill: `repoctopus-build-${input.action}`,
    augmentationSkills: Object.freeze(augmentationSkills),
  });
}

export function createInitialBuildWork(facts: {
  runId: string;
  checkEpoch: number;
  definition: ChangeLifecycleDefinition;
  actionSkill: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  skillComposition?: EffectiveWorkSkillComposition;
  taskSet: SpecificationTaskSet;
  approvalHash: `sha256:${string}`;
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
  strategyId: string;
  executionMode: BuildExecutionMode;
  tddMode: BuildTddMode;
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
  strategyId?: string;
  bindingId?: string;
  planId?: string;
  planRevision?: number;
  packageId?: string;
  executionMode?: BuildExecutionMode;
  tddMode?: BuildTddMode;
  writeScopes?: readonly { repositoryId: string; paths: readonly string[] }[];
  taskId?: string;
  taskRevision?: `sha256:${string}`;
  skillComposition?: EffectiveWorkSkillComposition;
}): WorkDescriptor {
  const composition = buildActionSkillComposition({
    action: facts.kind.slice('build.'.length) as Exclude<BuildActionKind, 'plan-evidence'>,
    ...(facts.tddMode ? { tddMode: facts.tddMode } : {}),
  });
  const builtinAugmentationNames = facts.skillComposition
    ? facts.skillComposition.layers
        .filter((layer) => layer.role === 'builtin-augmentation')
        .map((layer) => layer.skill.name)
    : facts.augmentationSkills.map((skill) => skill.name);
  if (facts.actionSkill.name !== composition.actionSkill) {
    throw new Error(`Build Action Skill does not match frozen policy: ${facts.kind}`);
  }
  if (
    (facts.kind === 'build.execute' && !facts.tddMode) ||
    JSON.stringify(builtinAugmentationNames) !== JSON.stringify(composition.augmentationSkills)
  ) {
    throw new Error(`Build Action augmentation Skills do not match frozen policy: ${facts.kind}`);
  }
  const skillComposition =
    facts.skillComposition ??
    createEffectiveWorkSkillComposition({
      workKind: facts.kind,
      layers: [
        {
          role: 'action',
          origin: 'builtin',
          order: 0,
          bindingId: null,
          slotId: null,
          replacedSkillName: null,
          skill: facts.actionSkill,
        },
        ...facts.augmentationSkills.map((skill, index) => ({
          role: 'builtin-augmentation' as const,
          origin: 'builtin' as const,
          order: index + 1,
          bindingId: null,
          slotId: null,
          replacedSkillName: null,
          skill,
        })),
      ],
    });
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: facts.kind,
    actionSkill: facts.actionSkill,
    augmentationSkills: facts.augmentationSkills,
    skillComposition,
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
    executionMode: facts.executionMode ?? null,
    tddMode: facts.tddMode ?? null,
  };
  const inputDigest = sha256(stableInput);
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
  const modeCapability =
    facts.executionMode === 'subagent-driven-development'
      ? 'subagent.dispatch.attested'
      : facts.executionMode === 'autonomous'
        ? 'build.autonomous'
        : null;
  const hostCapabilities =
    facts.kind === 'build.configure' && facts.executionMode
      ? executionBindingRequiredCapabilities(facts.executionMode)
      : modeCapability
        ? [modeCapability]
        : [];
  return {
    schemaVersion: 2,
    workId: `${facts.kind}:${inputDigest.slice('sha256:'.length, 19)}`,
    checkEpoch: facts.checkEpoch,
    ...binding,
    capabilities: [...new Set([...binding.capabilities, ...hostCapabilities])].sort(),
    buildAction: facts.kind.slice('build.'.length) as NonNullable<WorkDescriptor['buildAction']>,
    ...(facts.strategyId ? { strategyId: facts.strategyId } : {}),
    ...(facts.bindingId ? { bindingId: facts.bindingId } : {}),
    ...(facts.planId ? { planId: facts.planId } : {}),
    ...(facts.planRevision !== undefined ? { planRevision: facts.planRevision } : {}),
    ...(facts.packageId ? { packageId: facts.packageId } : {}),
    ...(facts.executionMode ? { executionMode: facts.executionMode } : {}),
    ...(facts.tddMode ? { tddMode: facts.tddMode } : {}),
    augmentationSkills: structuredClone(facts.augmentationSkills),
    writeScopes,
    ...(facts.taskId ? { taskId: facts.taskId } : {}),
    ...(facts.taskRevision ? { taskRevision: facts.taskRevision } : {}),
    inputDigest,
  };
}
