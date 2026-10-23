import { createHash } from 'node:crypto';

import type { SpecificationTask, SpecificationTaskSet } from '../specification/types.js';
import { readySpecificationTasks } from '../specification/tasks.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinitionSnapshot, WorkDescriptor } from './transition.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createInitialBuildWork(input: {
  runId: string;
  definition: ChangeLifecycleDefinitionSnapshot;
  taskSet: SpecificationTaskSet;
  approvalHash: `sha256:${string}`;
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  repositoryIds: readonly string[];
}): { tasks: SpecificationTask[]; work: WorkDescriptor } {
  const ready = readySpecificationTasks(input.taskSet.tasks);
  if (ready.length !== 1) {
    throw new Error(`Build requires exactly one ready Task; found ${ready.length}`);
  }
  const task = ready[0]!;
  const stableInput = {
    runId: input.runId,
    taskId: task.taskId,
    taskRevision: task.taskRevision,
    taskSetDigest: input.taskSet.digest,
    approvalHash: input.approvalHash,
    compositionDigest: input.compositionDigest,
    projectConfigDigest: input.projectConfigDigest,
    projectSnapshotDigest: input.projectSnapshotDigest,
    repositoryIds: [...input.repositoryIds].sort(),
  };
  const inputDigest = sha256(stableInput);
  const methodProfile = {
    id: 'repoctopus.build',
    version: '1.0.0',
    digest: sha256({ id: 'repoctopus.build', version: '1.0.0', rules: [] }),
    sourceDigests: [],
    ruleIds: [],
  } as const;
  const validatorProfile = {
    id: 'build.task-valid',
    version: '1.0.0',
    digest: sha256({ id: 'build.task-valid', version: '1.0.0' }),
  } as const;
  return {
    tasks: structuredClone(input.taskSet.tasks),
    work: {
      schemaVersion: 1,
      workId: `build:${task.taskId}:${inputDigest.slice('sha256:'.length, 19)}`,
      phase: 'build',
      kind: 'task.implement',
      taskId: task.taskId,
      taskRevision: task.taskRevision,
      augmentationSkills: [],
      methodProfile,
      capabilities: ['process.execute', 'repository.read', 'repository.write'],
      sideEffectClass: 'repository-write',
      writeScopes: [...new Set(input.repositoryIds)]
        .sort()
        .map((repositoryId) => ({
          repositoryId,
          paths: ['**'],
          operations: ['create', 'update', 'delete'] as const,
        })),
      inputDigest,
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile,
      authorizationSource: {
        kind: 'lifecycle-definition',
        definitionId: input.definition.id,
        definitionVersion: input.definition.version,
      },
      checkpoint: 'build.before-task',
    },
  };
}
