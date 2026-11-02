import { createHash } from 'node:crypto';

import type { EvidenceFingerprint } from '../evidence/fingerprint.js';
import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type {
  SpecificationAcceptanceCriterion,
  SpecificationTask,
} from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export interface VerificationInput {
  schemaVersion: 3;
  runId: string;
  checkEpoch: number;
  taskRevisions: readonly { taskId: string; taskRevision: `sha256:${string}` }[];
  acceptanceCriteria: readonly SpecificationAcceptanceCriterion[];
  acceptanceSetHash: `sha256:${string}`;
  acceptanceCoverage: readonly {
    acceptanceId: `acceptance-${string}`;
    nodeIds: readonly string[];
  }[];
  repositories: readonly {
    repositoryId: string;
    commit: string;
    tree: string;
    dirtyFilesDigest: `sha256:${string}`;
    inputPolicyDigest: `sha256:${string}`;
    controlPlaneInputDigest: `sha256:${string}`;
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

function resolveAcceptanceCoverage(
  tasks: readonly SpecificationTask[],
  plan: EvidenceExecutionPlan,
): Pick<VerificationInput, 'acceptanceCriteria' | 'acceptanceSetHash' | 'acceptanceCoverage'> {
  const acceptanceCriteria = tasks
    .flatMap((task) => task.acceptanceCriteria.map((criterion) => structuredClone(criterion)))
    .sort((left, right) => left.acceptanceId.localeCompare(right.acceptanceId));
  if (acceptanceCriteria.length === 0) {
    throw new Error('Verification input requires at least one approved Acceptance criterion');
  }
  const ids = acceptanceCriteria.map((criterion) => criterion.acceptanceId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Verification input contains duplicate Acceptance identities');
  }
  const nodeIdsByAcceptance = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const node of plan.nodes) {
    const selectors = node.covers ?? [];
    if (new Set(selectors).size !== selectors.length) {
      throw new Error(`Evidence node ${node.id} contains duplicate Acceptance selectors`);
    }
    for (const selector of selectors) {
      const matched = acceptanceCriteria.filter((criterion) => {
        if (selector === '*') return true;
        if (selector.startsWith('acceptance-')) return criterion.acceptanceId === selector;
        if (selector.startsWith('task:'))
          return criterion.taskId === selector.slice('task:'.length);
        if (selector.startsWith('requirement:')) {
          return criterion.requirementRefs.includes(selector.slice('requirement:'.length));
        }
        throw new Error(`Evidence node ${node.id} has an invalid Acceptance selector: ${selector}`);
      });
      if (matched.length === 0) {
        throw new Error(`Evidence node ${node.id} has an unknown Acceptance selector: ${selector}`);
      }
      if (node.required) {
        for (const criterion of matched)
          nodeIdsByAcceptance.get(criterion.acceptanceId)!.add(node.id);
      }
    }
  }
  const acceptanceCoverage = acceptanceCriteria.map((criterion) => ({
    acceptanceId: criterion.acceptanceId,
    nodeIds: [...nodeIdsByAcceptance.get(criterion.acceptanceId)!].sort(),
  }));
  const uncovered = acceptanceCoverage.filter((coverage) => coverage.nodeIds.length === 0);
  if (uncovered.length > 0) {
    throw new Error(
      `Verification Evidence Profile does not cover Acceptance: ${uncovered
        .map((coverage) => coverage.acceptanceId)
        .join(', ')}`,
    );
  }
  return {
    acceptanceCriteria,
    acceptanceSetHash: sha256({ schemaVersion: 1, acceptanceCriteria }),
    acceptanceCoverage,
  };
}

export function createVerificationInput(input: {
  runId: string;
  checkEpoch: number;
  tasks: readonly SpecificationTask[];
  fingerprint: EvidenceFingerprint;
  plan: EvidenceExecutionPlan;
  projectConfigDigest: `sha256:${string}`;
  compositionDigest: string;
  skills: readonly SkillUsageSnapshot[];
}): VerificationInput {
  if (!input.runId.trim()) throw new Error('Verification input requires a Run identity');
  if (!Number.isSafeInteger(input.checkEpoch) || input.checkEpoch < 0) {
    throw new Error('Verification input requires a non-negative checkEpoch');
  }
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
  if (input.fingerprint.manifest.schemaVersion !== 2) {
    throw new Error('Verification input requires Evidence fingerprint schema v2');
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
  const acceptance = resolveAcceptanceCoverage(input.tasks, input.plan);
  const stable = {
    schemaVersion: 3 as const,
    runId: input.runId,
    checkEpoch: input.checkEpoch,
    taskRevisions: input.tasks
      .map(({ taskId, taskRevision }) => ({ taskId, taskRevision }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    ...acceptance,
    repositories: input.fingerprint.manifest.repositories
      .map((repository) => {
        if (!repository.repositoryId.trim() || !repository.head.trim() || !repository.tree.trim()) {
          throw new Error('Verification repository fingerprint is incomplete');
        }
        if (
          !/^sha256:[a-f0-9]{64}$/u.test(repository.inputPolicyDigest) ||
          !/^sha256:[a-f0-9]{64}$/u.test(repository.controlPlane.digest)
        ) {
          throw new Error('Verification repository input policy fingerprint is incomplete');
        }
        return {
          repositoryId: repository.repositoryId,
          commit: repository.head,
          tree: repository.tree,
          dirtyFilesDigest: sha256(repository.dirtyFiles),
          inputPolicyDigest: repository.inputPolicyDigest,
          controlPlaneInputDigest: repository.controlPlane.digest,
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

export function rebaseVerificationInput(
  input: VerificationInput,
  checkEpoch: number,
): VerificationInput {
  if (!Number.isSafeInteger(checkEpoch) || checkEpoch < 0) {
    throw new Error('Verification input rebase requires a non-negative checkEpoch');
  }
  const { digest: _digest, ...stable } = input;
  void _digest;
  const rebased = { ...structuredClone(stable), checkEpoch };
  return { ...rebased, digest: sha256(rebased) };
}
