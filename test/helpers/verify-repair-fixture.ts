import { createHash } from 'node:crypto';
import {
  advanceBuildProtocol,
  advanceBuildWorkspaceCheckpoint,
  createBuildPlan,
  createBuildProtocolState,
  createBuildStrategy,
  createExecutionBinding,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
  createPackageCompletionEvidence,
  createPlanEvidence,
  validateBuildPlan,
} from '../../domains/change-lifecycle/build-protocol.js';
import { parseSpecificationTasks } from '../../domains/specification/tasks.js';
import { hostAbsolutePath } from './host-path.js';

export const repairDigest = (value: string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}` as const;

export function verifyRepairFixture(dependsOn: readonly string[] = []) {
  const runId = 'run-verify-repair';
  const tasks = parseSpecificationTasks(
    'verify-repair',
    ['a', 'b', 'c', 'd']
      .map(
        (key, i) =>
          `- [ ] 1.${i + 1} Implement ${key}.\n  **Acceptance:** ${key} behaves correctly.\n`,
      )
      .join(''),
  );
  const intent = createExecutionWorkspaceIntent({
    workspaceId: 'team',
    changeId: 'verify-repair',
    isolation: 'branch',
  });
  const workspace = createExecutionWorkspaceBinding({
    intent,
    repositories: [
      {
        repositoryId: 'workspace',
        checkoutPath: hostAbsolutePath('repair-workspace'),
        branch: 'codex/repair',
        head: 'a'.repeat(40),
        worktreeId: 'repair-workspace',
        workspaceOwned: true,
      },
    ],
  });
  const strategy = createBuildStrategy({
    runId,
    revision: 1,
    executionMode: 'autonomous',
    tddMode: 'direct',
    reviewMode: 'standard',
    isolationIntent: 'branch',
  });
  const binding = createExecutionBinding({
    strategy,
    revision: 1,
    coordinatorHostId: 'test',
    workspaceBinding: workspace,
    workspaceOwnerId: 'team',
    localOverlayRef: 'execution-workspace:test',
  });
  const candidate = {
    packages: tasks.tasks.map((task, i) => ({
      packageKey: ['a', 'b', 'c', 'd'][i]!,
      taskIds: [task.taskId],
      repositoryIds: ['workspace'],
      writeScopes: [{ repositoryId: 'workspace', paths: [`src/${i}/**`] }],
      acceptanceRefs: task.acceptanceCriteria.map((x) => x.acceptanceId),
      expectedOutcomes: [`behavior-${i}`],
      validatorProfile: 'build.package-valid',
      dependsOn: i === 1 ? dependsOn : [],
      sideEffectClass: 'repository-write' as const,
      completionContract: {
        schemaVersion: 1 as const,
        behaviorSlice: `behavior-${i}`,
        requiredEvidence: ['acceptance', 'implementation', 'test', 'regression'] as const,
      },
    })),
  };
  const plan = createBuildPlan({
    runId,
    revision: 1,
    strategy,
    binding,
    planningDigest: tasks.digest,
    tasks,
    candidate,
  });
  let protocol = advanceBuildProtocol(
    createBuildProtocolState({ runId, planningDigest: tasks.digest, strategy }),
    { kind: 'binding-accepted', binding },
  );
  const nextCheckpoint = () =>
    advanceBuildWorkspaceCheckpoint({
      current: protocol.workspaceCheckpoint!,
      observed: protocol.workspaceCheckpoint!.repositories,
      writableRepositoryIds: ['workspace'],
      relations: { workspace: 'unchanged' },
    });
  protocol = advanceBuildProtocol(protocol, {
    kind: 'plan-accepted',
    plan,
    workspaceCheckpoint: nextCheckpoint(),
  });
  const evidence = createPlanEvidence({
    plan,
    strategy,
    binding,
    validation: validateBuildPlan({ plan, strategy, binding, tasks, protectedBranches: ['main'] }),
    protectedBranches: ['main'],
    compositionCheckpointDigest: repairDigest('composition'),
    reportOwnerId: 'reviewer',
  });
  protocol = advanceBuildProtocol(protocol, { kind: 'plan-evidence-accepted', evidence });
  for (const workPackage of plan.packages) {
    const checkpoint = nextCheckpoint();
    protocol = advanceBuildProtocol(protocol, {
      kind: 'package-completed',
      workspaceCheckpoint: checkpoint,
      completion: createPackageCompletionEvidence({
        workPackage,
        executionId: `execute-${workPackage.packageKey}`,
        acceptanceEvidenceIds: [`accept-${workPackage.packageKey}`],
        testEvidenceIds: [`test-${workPackage.packageKey}`],
        tddMode: 'direct',
        workspaceCheckpointDigest: checkpoint.digest,
        implementationDigest: repairDigest(workPackage.packageKey),
      }),
    });
  }
  return { runId, tasks, strategy, binding, candidate, plan, protocol };
}
