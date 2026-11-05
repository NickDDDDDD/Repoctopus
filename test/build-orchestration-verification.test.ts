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
            sideEffectClass: 'repository-write',
            completionContract: {
              schemaVersion: 1,
              behaviorSlice: 'managed-orchestration',
              requiredEvidence: ['acceptance', 'implementation', 'red', 'green', 'regression'],
            },
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
      definition: 'repoctopus-change@4.9.0',
      definitionDigest: 'sha256:9386818aa775d1a328934c99533c639294f20585bc54f0df8543cbd036dc2500',
      runId: 'change-verification-workspace-restore-runtime-build-orchestration-9fda2eb7bf05fdf5',
      blackBoxRunId: 'change-managed-blackbox-managed-blackbox-a56af5c947f984ce',
      strategyId: 'build-strategy:426031405571f2b72e439071',
      strategyDigest: 'sha256:912ec16c53070e44b5f6dc57005492e6b2d4362853a1253a149341e65cd4c50c',
      bindingId: 'execution-binding:fbfc15dcbf8411a9f3a89f2b',
      bindingStateDigest: 'sha256:691849e3d564f6f99fe3dde34ef68909e283d9cea775ca409cd22c90bc31bc09',
      planId: 'build-plan:937746cc48a1bd507f90cf61',
      planDigest: 'sha256:3db0cd8710128292326e28c0d6172dd945cb1e5c937746cc48a1bd507f90cf61',
      taskSetDigest: 'sha256:d96a472d5f9b11f299872af949d92193398bfe295dc727cd7f7eeefb6629cc2f',
    });
  });
});
