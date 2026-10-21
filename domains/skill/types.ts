import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill';

export interface SkillUsageSnapshot {
  schemaVersion: 1;
  name: string;
  provider: string;
  invocation: SkillInvocationPolicy;
  contentDigest: `sha256:${string}`;
  resourceManifestDigest: `sha256:${string}`;
}

export interface SkillCompatibility {
  status: 'same' | 'drifted';
  changedSkills: string[];
  reason: string;
}

export function sameSkillUsageSnapshot(
  left: SkillUsageSnapshot,
  right: SkillUsageSnapshot,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.name === right.name &&
    left.provider === right.provider &&
    left.invocation.modelInvocable === right.invocation.modelInvocable &&
    left.invocation.userInvocable === right.invocation.userInvocable &&
    left.contentDigest === right.contentDigest &&
    left.resourceManifestDigest === right.resourceManifestDigest
  );
}
