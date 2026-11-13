import { buildActionSkillComposition } from '../change-lifecycle/build-work.js';
import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../change-lifecycle/definition.js';

export const BUILTIN_DIAGNOSTIC_SKILL = 'diagnosing-bugs';

export const BUILTIN_WORKFLOW_SKILL_NAMES = [
  ...new Set([
    ...BUILTIN_CHANGE_LIFECYCLE_DEFINITION.works.flatMap((work) => [
      ...(work.actionSkill ? [work.actionSkill.name] : []),
      ...work.augmentationSkills.map(({ name }) => name),
    ]),
    ...buildActionSkillComposition({ action: 'execute', tddMode: 'tdd' }).augmentationSkills,
    ...buildActionSkillComposition({ action: 'check' }).augmentationSkills,
    BUILTIN_DIAGNOSTIC_SKILL,
  ]),
];
