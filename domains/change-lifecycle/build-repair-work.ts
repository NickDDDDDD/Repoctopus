import { createHash } from 'node:crypto';

import type { SkillUsageSnapshot } from '../skill/types.js';
import type { WorkExecutionFinding } from '../work-execution/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  ChangeLifecycleDefinition,
  VerificationInvalidation,
  WorkDescriptor,
} from './transition.js';
import { materializeLifecycleWorkBinding } from './work-definition.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

/**
 * Materialize one explicit Build repair round without falsifying the approved Task ledger.
 * Findings explain why the round exists; OpenSpec Tasks remain the planning authority.
 */
export function createBuildRepairWork(facts: {
  runId: string;
  checkEpoch: number;
  definition: ChangeLifecycleDefinition;
  actionSkill: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  planningDigest: `sha256:${string}`;
  invalidation: VerificationInvalidation;
  findings: readonly WorkExecutionFinding[];
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}): WorkDescriptor {
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'implementation.repair',
    actionSkill: facts.actionSkill,
    augmentationSkills: facts.augmentationSkills,
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const stableInput = {
    runId: facts.runId,
    checkEpoch: facts.checkEpoch,
    planningDigest: facts.planningDigest,
    invalidation: facts.invalidation,
    findings: facts.findings,
    compositionDigest: facts.compositionDigest,
    projectConfigDigest: facts.projectConfigDigest,
    projectSnapshotDigest: facts.projectSnapshotDigest,
    repositoryIds: [...facts.repositoryIds].sort(),
    binding,
  };
  const inputDigest = sha256(stableInput);
  return {
    schemaVersion: 2,
    workId: `repair:${inputDigest.slice('sha256:'.length, 19)}`,
    checkEpoch: facts.checkEpoch,
    ...binding,
    inputDigest,
  };
}
