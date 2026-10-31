import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import {
  createEffectiveWorkSkillComposition,
  type EffectiveWorkSkillComposition,
} from '../skill/composition.js';
import type {
  ChangeLifecycleDefinition,
  ChangeLifecycleWorkDefinition,
  WorkDescriptor,
} from './transition.js';

export function lifecycleWorkDefinition(
  definition: ChangeLifecycleDefinition,
  kind: string,
): ChangeLifecycleWorkDefinition {
  const matches = definition.works.filter((candidate) => candidate.kind === kind);
  if (matches.length !== 1) {
    throw new Error(`Lifecycle Work definition must resolve exactly once: ${kind}`);
  }
  return structuredClone(matches[0]!);
}

export function materializeLifecycleWorkBinding(input: {
  definition: ChangeLifecycleDefinition;
  kind: string;
  actionSkill?: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  skillComposition?: EffectiveWorkSkillComposition;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): Pick<
  WorkDescriptor,
  | 'phase'
  | 'kind'
  | 'actionSkill'
  | 'augmentationSkills'
  | 'skillComposition'
  | 'methodProfile'
  | 'capabilities'
  | 'sideEffectClass'
  | 'writeScopes'
  | 'outputContract'
  | 'validatorProfile'
  | 'authorizationSource'
  | 'checkpoint'
> {
  const work = lifecycleWorkDefinition(input.definition, input.kind);
  if (work.actionSkill?.name !== input.actionSkill?.name) {
    throw new Error(`Lifecycle Work action Skill does not match definition: ${work.kind}`);
  }
  const skillComposition =
    input.skillComposition ??
    createEffectiveWorkSkillComposition({
      workKind: work.kind,
      layers: [
        ...(input.actionSkill
          ? [
              {
                role: 'action' as const,
                origin: 'builtin' as const,
                order: 0,
                bindingId: null,
                slotId: null,
                replacedSkillName: null,
                skill: input.actionSkill,
              },
            ]
          : []),
        ...input.augmentationSkills.map((skill, index) => ({
          role: 'builtin-augmentation' as const,
          origin: 'builtin' as const,
          order: index + 1,
          bindingId: null,
          slotId:
            work.augmentationSlots?.find((slot) => slot.defaultSkill.name === skill.name)?.id ??
            null,
          replacedSkillName: null,
          skill,
        })),
      ],
    });
  if (skillComposition.workKind !== work.kind) {
    throw new Error(`Skill composition belongs to another lifecycle Work: ${work.kind}`);
  }
  const actionLayers = skillComposition.layers.filter((layer) => layer.role === 'action');
  if (
    actionLayers.length !== (input.actionSkill ? 1 : 0) ||
    actionLayers[0]?.skill.name !== input.actionSkill?.name
  ) {
    throw new Error(`Lifecycle Work action Skill composition is invalid: ${work.kind}`);
  }
  const expectedAugmentations = input.skillComposition
    ? skillComposition.layers
        .filter((layer) => layer.role !== 'action')
        .map((layer) => layer.skill.name)
    : work.augmentationSkills.map((skill) => skill.name);
  const actualAugmentations = input.augmentationSkills.map((skill) => skill.name);
  if (canonicalJson(expectedAugmentations) !== canonicalJson(actualAugmentations)) {
    throw new Error(`Lifecycle Work augmentation Skills do not match definition: ${work.kind}`);
  }
  const repositories = [...new Set(input.repositoryIds)].sort();
  if (!repositories.includes(input.workspaceRepositoryId)) {
    throw new Error('Lifecycle Work Workspace Repository is not registered');
  }
  return {
    phase: work.phase,
    kind: work.kind,
    ...(input.actionSkill ? { actionSkill: structuredClone(input.actionSkill) } : {}),
    augmentationSkills: structuredClone(input.augmentationSkills),
    skillComposition: structuredClone(skillComposition),
    methodProfile: structuredClone(work.methodProfile),
    capabilities: [...work.capabilities],
    sideEffectClass: work.sideEffectClass,
    writeScopes: work.writeScopes.flatMap((scope) =>
      (scope.repositorySelector === 'workspace' ? [input.workspaceRepositoryId] : repositories).map(
        (repositoryId) => ({
          repositoryId,
          paths: [...scope.paths],
          operations: [...scope.operations],
        }),
      ),
    ),
    outputContract: structuredClone(work.outputContract),
    validatorProfile: structuredClone(work.validatorProfile),
    authorizationSource: {
      kind: 'lifecycle-definition',
      definitionId: input.definition.id,
      definitionVersion: input.definition.version,
    },
    checkpoint: work.checkpoint,
  };
}
