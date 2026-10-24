import { createHash } from 'node:crypto';

import type { EvidenceFingerprint } from '../evidence/fingerprint.js';
import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationTask } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export interface VerificationInput {
  schemaVersion: 1;
  runId: string;
  taskRevisions: readonly { taskId: string; taskRevision: `sha256:${string}` }[];
  repositories: readonly {
    repositoryId: string;
    commit: string;
    tree: string;
    dirtyFilesDigest: `sha256:${string}`;
  }[];
  projectConfigDigest: `sha256:${string}`;
  compositionDigest: string;
  skills: readonly SkillUsageSnapshot[];
  evidenceProfile: {
    id: string;
    planDigest: `sha256:${string}`;
    fingerprintDigest: string;
  };
  digest: `sha256:${string}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createVerificationInput(input: {
  runId: string;
  tasks: readonly SpecificationTask[];
  fingerprint: EvidenceFingerprint;
  plan: EvidenceExecutionPlan;
  projectConfigDigest: `sha256:${string}`;
  compositionDigest: string;
  skills: readonly SkillUsageSnapshot[];
}): VerificationInput {
  if (!input.runId.trim()) throw new Error('Verification input requires a Run identity');
  if (input.tasks.length === 0 || input.tasks.some((task) => task.status !== 'completed')) {
    throw new Error('Verification input requires every approved Task completion fact');
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.projectConfigDigest)) {
    throw new Error('Verification input requires a Project configuration digest');
  }
  if (!input.compositionDigest.trim()) {
    throw new Error('Verification input requires a composition digest');
  }
  if (input.plan.profileId !== input.fingerprint.manifest.profileId) {
    throw new Error('Verification Evidence Profile and fingerprint do not match');
  }
  if (input.plan.nodes.length === 0) {
    throw new Error(`Verification Evidence Profile has no nodes: ${input.plan.profileId}`);
  }
  if (input.fingerprint.manifest.repositories.length === 0) {
    throw new Error('Verification input requires at least one repository fingerprint');
  }
  if (input.skills.length === 0) throw new Error('Verification input requires bound Skills');
  const skillIdentities = input.skills.map((skill) => `${skill.provider}\0${skill.name}`);
  if (new Set(skillIdentities).size !== skillIdentities.length) {
    throw new Error('Verification input contains duplicate Skill identities');
  }
  const stable = {
    schemaVersion: 1 as const,
    runId: input.runId,
    taskRevisions: input.tasks
      .map(({ taskId, taskRevision }) => ({ taskId, taskRevision }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    repositories: input.fingerprint.manifest.repositories
      .map((repository) => {
        if (!repository.repositoryId.trim() || !repository.head.trim() || !repository.tree.trim()) {
          throw new Error('Verification repository fingerprint is incomplete');
        }
        return {
          repositoryId: repository.repositoryId,
          commit: repository.head,
          tree: repository.tree,
          dirtyFilesDigest: sha256(repository.dirtyFiles),
        };
      })
      .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
    projectConfigDigest: input.projectConfigDigest,
    compositionDigest: input.compositionDigest,
    skills: [...input.skills].sort((left, right) =>
      `${left.provider}\0${left.name}`.localeCompare(`${right.provider}\0${right.name}`),
    ),
    evidenceProfile: {
      id: input.plan.profileId,
      planDigest: sha256(input.plan),
      fingerprintDigest: input.fingerprint.digest,
    },
  };
  return { ...stable, digest: sha256(stable) };
}
