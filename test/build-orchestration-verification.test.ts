import { describe, expect, it } from 'vitest';

import {
  createBuildStrategy,
  createExecutionBinding,
  createBuildPlan,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import { prepareChangeLifecycleDefinition } from '../domains/change-lifecycle/definition.js';
import { changeRunId } from '../domains/change-lifecycle/host-workflow.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

describe('managed Build verification subject', () => {
  it('pins a reproducible definition, Strategy, Binding, Plan, and Run identity', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'verification-workspace',
      changeId: 'restore-runtime-build-orchestration',
      isolation: 'current',
    });
    const binding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: 'C:\\verification\\workspace',
          branch: 'codex/spec-restore-build-orchestration',
          head: '1'.repeat(40),
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });
    const strategy = createBuildStrategy({
      runId: 'verification-build-strategy',
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: intent.isolation,
    });
    const executionBinding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'verification-host',
      workspaceBinding: binding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:verification',
    });
    const tasks = parseSpecificationTasks(
      'restore-runtime-build-orchestration',
      '- [ ] 1.1 Verify managed orchestration.\n  **Acceptance:** Managed orchestration passes.\n',
    );
    const runId = changeRunId({
      workspaceId: 'verification-workspace',
      changeId: 'restore-runtime-build-orchestration',
    });
    const plan = createBuildPlan({
      runId,
      revision: 1,
      strategy,
      binding: executionBinding,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'managed-orchestration',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map(
              (criterion) => criterion.acceptanceId,
            ),
            expectedOutcomes: ['managed-orchestration-passes'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
        ],
      },
    });
    const definition = prepareChangeLifecycleDefinition().snapshot;
    const subject = {
      definition: `${definition.id}@${definition.version}`,
      definitionDigest: definition.digest,
      runId,
      blackBoxRunId: changeRunId({
        workspaceId: 'managed-blackbox',
        changeId: 'managed-blackbox',
      }),
      strategyId: strategy.strategyId,
      strategyDigest: strategy.semanticDigest,
      bindingId: executionBinding.bindingId,
      bindingStateDigest: executionBinding.stateDigest,
      planId: plan.planId,
      planDigest: plan.digest,
      taskSetDigest: tasks.digest,
    };

    expect(subject).toEqual({
      definition: 'repoctopus-change@4.7.0',
      definitionDigest: 'sha256:8d2d951299cd9dbdc91bb7aaca960501311c1aed45123512c83dade34d19d2d1',
      runId: 'change-verification-workspace-restore-runtime-build-orchestration-9fda2eb7bf05fdf5',
      blackBoxRunId: 'change-managed-blackbox-managed-blackbox-a56af5c947f984ce',
      strategyId: 'build-strategy:426031405571f2b72e439071',
      strategyDigest: 'sha256:912ec16c53070e44b5f6dc57005492e6b2d4362853a1253a149341e65cd4c50c',
      bindingId: 'execution-binding:6ee0f764f84f455a6e68e2a8',
      bindingStateDigest: 'sha256:ffa558252660a6dcdfff7439fc13e52310fb8855503f8c12993588dbeb3a7921',
      planId: 'build-plan:23b7b0604af3a907ec85cd99',
      planDigest: 'sha256:98fbc02976fe2072af3eaca1d60c0cf41f79532c23b7b0604af3a907ec85cd99',
      taskSetDigest: 'sha256:d96a472d5f9b11f299872af949d92193398bfe295dc727cd7f7eeefb6629cc2f',
    });
  });
});
