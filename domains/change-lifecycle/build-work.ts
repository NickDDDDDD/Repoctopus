import { createHash } from 'node:crypto';

import type { SpecificationTask, SpecificationTaskSet } from '../specification/types.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import { readySpecificationTasks } from '../specification/tasks.js';
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
  const ready = readySpecificationTasks(facts.taskSet.tasks);
  if (ready.length === 0) throw new Error('Build has no ready Task');
  const task = ready[0]!;
  const binding = materializeLifecycleWorkBinding({
    definition: facts.definition,
    kind: 'task.implement',
    actionSkill: facts.actionSkill,
    augmentationSkills: facts.augmentationSkills,
    workspaceRepositoryId: facts.workspaceRepositoryId,
    repositoryIds: facts.repositoryIds,
  });
  const stableInput = {
    runId: facts.runId,
    checkEpoch: facts.checkEpoch,
    taskId: task.taskId,
    taskRevision: task.taskRevision,
    taskSetDigest: facts.taskSet.digest,
    approvalHash: facts.approvalHash,
    compositionDigest: facts.compositionDigest,
    projectConfigDigest: facts.projectConfigDigest,
    projectSnapshotDigest: facts.projectSnapshotDigest,
    repositoryIds: [...facts.repositoryIds].sort(),
    binding,
  };
  const inputDigest = sha256(stableInput);
  return {
    tasks: structuredClone(facts.taskSet.tasks),
    work: {
      schemaVersion: 2,
      workId: `build:${task.taskId}:${inputDigest.slice('sha256:'.length, 19)}`,
      checkEpoch: facts.checkEpoch,
      ...binding,
      taskId: task.taskId,
      taskRevision: task.taskRevision,
      inputDigest,
    },
  };
}
