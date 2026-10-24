import type { SkillUsageSnapshot } from '../skill/types.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import type { VerificationInput } from './verification-input.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';

export function createVerifyWork(facts: {
  definition: ChangeLifecycleDefinition;
  verification: VerificationInput;
  actionSkill: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'evidence.verify',
    actionSkill: facts.actionSkill,
    augmentationSkills: facts.augmentationSkills,
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  return {
    schemaVersion: 1,
    workId: `verify:${facts.verification.digest.slice('sha256:'.length, 19)}`,
    ...binding,
    inputDigest: facts.verification.digest,
  };
}
