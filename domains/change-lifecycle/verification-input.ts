import { createHash } from 'node:crypto';

import type { EvidenceFingerprint } from '../evidence/fingerprint.js';
import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type {
  SpecificationAcceptanceCriterion,
  SpecificationTask,
} from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { resolveAcceptanceCoverage } from './acceptance-coverage.js';
import {
  createEvidenceDependencyRecord,
  assertEvidenceDependencyRecord,
  evidenceDependencySetDigest,
  type EvidenceDependencyRecord,
} from '../evidence/dependencies.js';
import { evidenceInputDigest } from '../evidence/input-snapshot.js';

export interface VerificationInput {
  schemaVersion: 4;
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
  dependencies: EvidenceDependencyRecord;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function verificationDependencies(fingerprintDigest: string) {
  return [
    {
      partition: 'implementation-content' as const,
      identity: evidenceInputDigest(fingerprintDigest),
    },
  ];
}

/** Validates persisted semantics independently of mutable Git audit provenance. */
export function assertVerificationInput(value: unknown): asserts value is VerificationInput {
  if (!value || typeof value !== 'object') throw new Error('Verification Input is required');
  const input = value as VerificationInput;
  if (input.schemaVersion !== 4) throw new Error('Unsupported Verification Input schemaVersion');
  if (
    !input.runId?.trim() ||
    !Number.isSafeInteger(input.checkEpoch) ||
    input.checkEpoch < 0 ||
    !Array.isArray(input.taskRevisions) ||
    !Array.isArray(input.acceptanceCriteria) ||
    !Array.isArray(input.acceptanceCoverage) ||
    !Array.isArray(input.repositories) ||
    !Array.isArray(input.skills) ||
    !input.evidenceProfile?.id ||
    !input.evidenceProfile.fingerprintDigest
  )
    throw new Error('Invalid Verification Input facts');
  assertEvidenceDependencyRecord(input.dependencies, 'verification-input', input.digest);
  const expected = verificationDependencies(input.evidenceProfile.fingerprintDigest);
  if (
    canonicalJson(input.dependencies) !==
    canonicalJson(
      createEvidenceDependencyRecord({
        subjectKind: 'verification-input',
        subjectId: input.digest,
        dependencies: expected,
      }),
    )
  )
    throw new Error('Verification Input dependencies do not match its frozen inputs');
  const { digest, dependencies: _dependencies, repositories: _provenance, ...semantic } = input;
  void _dependencies;
  void _provenance;
  if (
    digest !== sha256({ ...semantic, dependencySetDigest: evidenceDependencySetDigest(expected) })
  )
    throw new Error('Verification Input identity does not match its facts and dependencies');
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
  if (input.fingerprint.manifest.schemaVersion !== 3) {
    throw new Error('Verification input requires Evidence fingerprint schema v3');
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
    schemaVersion: 4 as const,
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
  const { repositories: _provenance, ...semantic } = stable;
  void _provenance;
  const dependencies = verificationDependencies(input.fingerprint.digest);
  const digest = sha256({
    ...semantic,
    dependencySetDigest: evidenceDependencySetDigest(dependencies),
  });
  return {
    ...stable,
    digest,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'verification-input',
      subjectId: digest,
      dependencies,
    }),
  };
}

export function rebaseVerificationInput(
  input: VerificationInput,
  checkEpoch: number,
): VerificationInput {
  assertVerificationInput(input);
  if (!Number.isSafeInteger(checkEpoch) || checkEpoch < 0) {
    throw new Error('Verification input rebase requires a non-negative checkEpoch');
  }
  const { digest: _digest, dependencies: _dependencies, ...stable } = input;
  void _digest;
  void _dependencies;
  const rebased = { ...structuredClone(stable), checkEpoch };
  const { repositories: _provenance, ...semantic } = rebased;
  void _provenance;
  const digest = sha256({
    ...semantic,
    dependencySetDigest: evidenceDependencySetDigest(
      input.dependencies.dependencies,
      input.dependencies.dependsOnEvidenceIds,
    ),
  });
  return {
    ...rebased,
    digest,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'verification-input',
      subjectId: digest,
      dependencies: input.dependencies.dependencies,
      dependsOnEvidenceIds: input.dependencies.dependsOnEvidenceIds,
    }),
  };
}
