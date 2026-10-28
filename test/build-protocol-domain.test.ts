import { describe, expect, it } from 'vitest';

import {
  acceptBuildConfiguration,
  advanceBuildProtocol,
  createBuildConfigurationProposal,
  createBuildPlan,
  createBuildProtocolState,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
  createPlanEvidence,
  validateBuildPlan,
} from '../domains/change-lifecycle/build-protocol.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

const sha = (value: string): `sha256:${string}` => `sha256:${value.padEnd(64, value).slice(0, 64)}`;

function approvedConfiguration() {
  const intent = createExecutionWorkspaceIntent({
    workspaceId: 'team-platform',
    changeId: 'managed-build',
    isolation: 'worktree',
    targetBranch: 'codex/managed-build',
  });
  const binding = createExecutionWorkspaceBinding({
    intent,
    repositories: [
      {
        repositoryId: 'workspace',
        checkoutPath: 'C:\\work\\repoctopus-managed-build',
        branch: 'codex/managed-build',
        head: '0123456789abcdef0123456789abcdef01234567',
        worktreeId: 'wt-managed-build',
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
    hostId: 'codex-local',
    hostCapabilities: ['build.autonomous', 'process.execute', 'repository.write'],
  });
  return acceptBuildConfiguration({
    proposal,
    requestId: 'decision-configure-1',
    actorId: 'user-1',
    decidedAt: '2026-10-28T00:00:00.000Z',
  });
}

describe('Build protocol domain', () => {
  it('normalizes workspace and configuration input into stable immutable digests', () => {
    const first = approvedConfiguration();
    const second = approvedConfiguration();

    expect(first.semanticDigest).toBe(second.semanticDigest);
    expect(first.configurationId).toBe(second.configurationId);
    expect(first.bindingDigest).toBe(second.bindingDigest);
    expect(() => {
      (first.hostCapabilities as string[]).push('unsafe');
    }).toThrow();
  });

  it('rejects unsupported profiles and a Host without the selected mode capability', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'invalid',
      isolation: 'current',
    });
    const binding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: 'C:\\work\\repoctopus',
          branch: 'main',
          head: '0123456789abcdef0123456789abcdef01234567',
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });

    expect(() =>
      createBuildConfigurationProposal({
        intent,
        binding,
        executionMode: 'subagent-driven-development',
        tddMode: 'direct',
        reviewMode: 'standard',
        hostId: 'plain-host',
        hostCapabilities: ['process.execute'],
      }),
    ).toThrow(/subagent\.dispatch\.attested/u);
  });

  it('builds a canonical DAG projection that covers every OpenSpec Task', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      [
        '- [ ] 1.1 Define the model.',
        '  **Acceptance:** Stable identity is verified.',
        '- [ ] 1.2 Integrate the service.',
        '  **Blocked by:** 1.1',
        '  **Acceptance:** Restart recovery is verified.',
      ].join('\n'),
    );
    const plan = createBuildPlan({
      runId: 'run-1',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'model',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['model-tests-pass'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
          {
            packageKey: 'service',
            taskIds: ['1.2'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['services/**'] }],
            acceptanceRefs: tasks.tasks[1]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['restart-test-passes'],
            validatorProfile: 'build.package-valid',
            dependsOn: ['model'],
          },
        ],
      },
    });

    expect(validateBuildPlan({ plan, configuration, tasks }).accepted).toBe(true);
    expect(plan.packages.map((item) => item.packageId)).toHaveLength(2);
    expect(plan.packages[1]!.dependsOn).toEqual([plan.packages[0]!.packageId]);
  });

  it('rejects cycles, duplicate keys, unknown Tasks, and missing Task coverage', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Do one thing.\n  **Acceptance:** It works.\n',
    );
    const base = {
      packageKey: 'one',
      taskIds: ['1.1'],
      repositoryIds: ['workspace'],
      writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
      acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
      expectedOutcomes: ['tests-pass'],
      validatorProfile: 'build.package-valid',
      dependsOn: [] as string[],
    };

    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: { packages: [base, { ...base }] },
      }),
    ).toThrow(/duplicate package key/u);
    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: { packages: [{ ...base, taskIds: ['9.9'] }] },
      }),
    ).toThrow(/unknown Task/u);
    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: { packages: [] },
      }),
    ).toThrow(/cover every Task/u);
  });

  it('lets only the reducer choose the next Build Action', () => {
    const configuration = approvedConfiguration();
    const initial = createBuildProtocolState({
      runId: 'run-1',
      planningDigest: sha('a'),
      workspaceIntent: configuration.workspaceIntent,
    });
    expect(initial.currentAction).toBe('configure');
    const proposed = advanceBuildProtocol(initial, {
      kind: 'configuration-proposed',
      proposal: configuration,
    });
    const configured = advanceBuildProtocol(proposed, {
      kind: 'configuration-approved',
      configuration,
    });
    expect(configured.currentAction).toBe('plan');
    expect(() =>
      advanceBuildProtocol(configured, {
        kind: 'host-outcome',
        action: 'execute',
        accepted: true,
      }),
    ).toThrow(/current Runtime-selected Action/u);
    expect(() =>
      advanceBuildProtocol(configured, {
        kind: 'host-outcome',
        action: 'execute',
        accepted: true,
        requestedNextAction: 'check',
      }),
    ).toThrow(/Host cannot select/u);
  });

  it('advances the complete Action protocol and keeps retries on the same Action', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Implement it.\n  **Acceptance:** Tests pass.\n',
    );
    const plan = createBuildPlan({
      runId: 'run-1',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'implementation',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['tests-pass'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
        ],
      },
    });
    const initial = createBuildProtocolState({
      runId: 'run-1',
      planningDigest: tasks.digest,
      workspaceIntent: configuration.workspaceIntent,
    });
    const proposed = advanceBuildProtocol(initial, {
      kind: 'configuration-proposed',
      proposal: configuration,
    });
    const configured = advanceBuildProtocol(proposed, {
      kind: 'configuration-approved',
      configuration,
    });
    const planned = advanceBuildProtocol(configured, { kind: 'plan-accepted', plan });
    const evidence = createPlanEvidence({
      plan,
      configuration,
      validation: validateBuildPlan({ plan, configuration, tasks }),
    });
    const evidenced = advanceBuildProtocol(planned, {
      kind: 'plan-evidence-accepted',
      evidence,
    });
    const retry = advanceBuildProtocol(evidenced, {
      kind: 'host-outcome',
      action: 'execute',
      accepted: false,
    });
    const executed = advanceBuildProtocol(retry, {
      kind: 'host-outcome',
      action: 'execute',
      accepted: true,
    });
    const checked = advanceBuildProtocol(executed, {
      kind: 'host-outcome',
      action: 'check',
      accepted: true,
    });

    expect([
      initial.currentAction,
      configured.currentAction,
      planned.currentAction,
      evidenced.currentAction,
      retry.currentAction,
      executed.currentAction,
      checked.currentAction,
    ]).toEqual(['configure', 'plan', 'plan-evidence', 'execute', 'execute', 'check', null]);
    expect(retry.actionAttempt).toBe(2);
    expect(checked.status).toBe('ready-for-verify');
  });
});
