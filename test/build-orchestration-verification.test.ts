import { describe, expect, it } from 'vitest';

import {
  acceptBuildConfiguration,
  createBuildConfigurationProposal,
  createBuildPlan,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import { prepareChangeLifecycleDefinition } from '../domains/change-lifecycle/definition.js';
import { changeRunId } from '../domains/change-lifecycle/host-workflow.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

describe('managed Build verification subject', () => {
  it('pins a reproducible definition, configuration, plan, and Run identity', () => {
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
    const proposal = createBuildConfigurationProposal({
      intent,
      binding,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      hostId: 'verification-host',
      hostCapabilities: ['build.autonomous', 'process.execute', 'repository.write'],
    });
    const configuration = acceptBuildConfiguration({
      proposal,
      requestId: 'verification-decision',
      actorId: 'verification-user',
      decidedAt: '2026-10-28T00:00:00.000Z',
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
      configuration,
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
      configurationId: configuration.configurationId,
      configurationDigest: configuration.semanticDigest,
      planId: plan.planId,
      planDigest: plan.digest,
      taskSetDigest: tasks.digest,
    };

    expect(subject).toEqual({
      definition: 'repoctopus-change@4.5.0',
      definitionDigest: 'sha256:5252e73b922907deecf113e2e4ec4a6a8b4891cb99c6db93e3cf5e2e107d7028',
      runId: 'change-verification-workspace-restore-runtime-build-orchestration-9fda2eb7bf05fdf5',
      blackBoxRunId: 'change-managed-blackbox-managed-blackbox-a56af5c947f984ce',
      configurationId: 'build-configuration:984df01c5c917e6286a1e112',
      configurationDigest:
        'sha256:af6f56776fd582eca909f27e86f0d22804d82cd7984df01c5c917e6286a1e112',
      planId: 'build-plan:8bf9212ab473dd6fd62f4dad',
      planDigest: 'sha256:18a60cf28483c14808c524f98621f4f31ae5d0ec8bf9212ab473dd6fd62f4dad',
      taskSetDigest: 'sha256:d96a472d5f9b11f299872af949d92193398bfe295dc727cd7f7eeefb6629cc2f',
    });
  });
});
