import { describe, expect, it } from 'vitest';

import {
  acceptBuildConfiguration,
  advanceBuildProtocol,
  assessBuildPlanRisk,
  createBuildCheckEvidence,
  createBuildConfigurationProposal,
  createBuildInvalidation,
  createBuildPlan,
  createBuildProtocolState,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
  createPackageCompletionEvidence,
  createPlanEvidence,
  validateBuildPlan,
} from '../domains/change-lifecycle/build-protocol.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

const sha = (value: string): `sha256:${string}` => `sha256:${value.padEnd(64, value).slice(0, 64)}`;

function approvedConfiguration(options: {
  repositoryIds?: readonly string[];
  executionMode?: 'autonomous' | 'subagent-driven-development';
  tddMode?: 'tdd' | 'direct';
} = {}) {
  const repositoryIds = options.repositoryIds ?? ['workspace'];
  const executionMode = options.executionMode ?? 'autonomous';
  const intent = createExecutionWorkspaceIntent({
    workspaceId: 'team-platform',
    changeId: 'managed-build',
    isolation: 'worktree',
    targetBranch: 'codex/managed-build',
  });
  const binding = createExecutionWorkspaceBinding({
    intent,
    repositories: repositoryIds.map((repositoryId, index) =>
      ({
        repositoryId,
        checkoutPath: `C:\\work\\repoctopus-managed-build-${repositoryId}`,
        branch: 'codex/managed-build',
        head: `${index}`.padEnd(40, 'a'),
        worktreeId: `wt-managed-build-${repositoryId}`,
        workspaceOwned: true,
      }) as const,
    ),
  });
  const proposal = createBuildConfigurationProposal({
    intent,
    binding,
    executionMode,
    tddMode: options.tddMode ?? 'tdd',
    reviewMode: 'standard',
    hostId: 'codex-local',
    hostCapabilities: [
      executionMode === 'autonomous' ? 'build.autonomous' : 'subagent.dispatch.attested',
      'process.execute',
      'repository.write',
    ],
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

  it('supports Task splitting, strongly-coupled Task merging, and deterministic cross-repository risk', () => {
    const configuration = approvedConfiguration({
      repositoryIds: ['workspace', 'backend'],
      executionMode: 'subagent-driven-development',
    });
    const tasks = parseSpecificationTasks(
      'managed-build',
      [
        '- [ ] 1.1 Define the contract.',
        '  **Acceptance:** Contract tests pass.',
        '- [ ] 1.2 Integrate the contract.',
        '  **Acceptance:** Integration tests pass.',
      ].join('\n'),
    );
    const acceptance = tasks.tasks.flatMap((task) =>
      task.acceptanceCriteria.map((criterion) => criterion.acceptanceId),
    );
    const merged = createBuildPlan({
      runId: 'run-merge',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'coupled-contract',
            taskIds: ['1.1', '1.2'],
            repositoryIds: ['workspace', 'backend'],
            writeScopes: [
              { repositoryId: 'workspace', paths: ['domains/**'] },
              { repositoryId: 'backend', paths: ['src/**'] },
            ],
            acceptanceRefs: acceptance,
            expectedOutcomes: ['contract-and-integration-pass'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
        ],
      },
    });
    expect(merged.packages[0]!.taskIds).toEqual(['1.1', '1.2']);
    expect(assessBuildPlanRisk(merged)).toMatchObject({
      level: 'high',
      reasons: ['cross-repository-package'],
    });

    const singleTask = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Implement the feature.\n  **Acceptance:** End-to-end behavior passes.\n',
    );
    const criterion = singleTask.tasks[0]!.acceptanceCriteria[0]!.acceptanceId;
    const split = createBuildPlan({
      runId: 'run-split',
      revision: 1,
      configuration,
      planningDigest: singleTask.digest,
      tasks: singleTask,
      candidate: {
        packages: [
          {
            packageKey: 'workspace-half',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
            acceptanceRefs: [criterion],
            expectedOutcomes: ['workspace-ready'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
          {
            packageKey: 'backend-half',
            taskIds: ['1.1'],
            repositoryIds: ['backend'],
            writeScopes: [{ repositoryId: 'backend', paths: ['src/**'] }],
            acceptanceRefs: [criterion],
            expectedOutcomes: ['backend-ready'],
            validatorProfile: 'build.package-valid',
            dependsOn: ['workspace-half'],
          },
        ],
      },
    });
    expect(split.packages).toHaveLength(2);
    expect(assessBuildPlanRisk(split)).toMatchObject({
      level: 'high',
      reasons: ['cross-repository-order'],
    });
  });

  it('retains only still-valid package completion across a Build Plan revision', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      [
        '- [ ] 1.1 Build the model.',
        '  **Acceptance:** Model behavior passes.',
        '- [ ] 1.2 Build the service.',
        '  **Acceptance:** Service behavior passes.',
      ].join('\n'),
    );
    const candidate = (serviceOutcome: string) => ({
      packages: [
        {
          packageKey: 'model',
          taskIds: ['1.1'],
          repositoryIds: ['workspace'],
          writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
          acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
          expectedOutcomes: ['model-passes'],
          validatorProfile: 'build.package-valid',
          dependsOn: [],
        },
        {
          packageKey: 'service',
          taskIds: ['1.2'],
          repositoryIds: ['workspace'],
          writeScopes: [{ repositoryId: 'workspace', paths: ['services/**'] }],
          acceptanceRefs: tasks.tasks[1]!.acceptanceCriteria.map((item) => item.acceptanceId),
          expectedOutcomes: [serviceOutcome],
          validatorProfile: 'build.package-valid',
          dependsOn: ['model'],
        },
      ],
    });
    const plan1 = createBuildPlan({
      runId: 'run-revision',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: candidate('service-passes'),
    });
    let state = createBuildProtocolState({
      runId: 'run-revision',
      planningDigest: tasks.digest,
      workspaceIntent: configuration.workspaceIntent,
    });
    state = advanceBuildProtocol(state, { kind: 'configuration-proposed', proposal: configuration });
    state = advanceBuildProtocol(state, { kind: 'configuration-approved', configuration });
    state = advanceBuildProtocol(state, { kind: 'plan-accepted', plan: plan1 });
    state = advanceBuildProtocol(state, {
      kind: 'plan-evidence-accepted',
      evidence: createPlanEvidence({
        plan: plan1,
        configuration,
        validation: validateBuildPlan({ plan: plan1, configuration, tasks }),
      }),
    });
    const modelCompletion = createPackageCompletionEvidence({
      workPackage: plan1.packages[0]!,
      executionId: 'model-execution',
      acceptanceEvidenceIds: ['model-acceptance'],
      testEvidenceIds: ['model-test'],
      tddMode: 'tdd',
      tddEvidence: {
        redEvidenceId: 'model-red',
        greenEvidenceId: 'model-green',
        regressionEvidenceId: 'model-regression',
      },
      repositoryDigest: sha('b'),
      implementationDigest: sha('c'),
    });
    state = advanceBuildProtocol(state, { kind: 'package-completed', completion: modelCompletion });
    const invalidation = createBuildInvalidation({
      source: 'build-check',
      plan: plan1,
      classification: 'implementation',
      affectedPackageIds: [plan1.packages[1]!.packageId],
      packageCompletions: state.packageCompletions,
      reason: 'Service package needs a bounded implementation revision',
    });
    state = advanceBuildProtocol(state, { kind: 'revision-required', invalidation });
    const plan2 = createBuildPlan({
      runId: 'run-revision',
      revision: 2,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: candidate('service-and-regression-pass'),
    });
    state = advanceBuildProtocol(state, { kind: 'plan-accepted', plan: plan2 });

    expect(state.plans).toHaveLength(2);
    expect(state.packageCompletions).toEqual([modelCompletion]);
    expect(state.invalidations).toEqual([invalidation]);
    expect(plan2.packages[0]!.packageId).toBe(plan1.packages[0]!.packageId);
    expect(plan2.packages[1]!.packageId).not.toBe(plan1.packages[1]!.packageId);
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
    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: {
          packages: [
            base,
            {
              ...base,
              packageKey: 'orphan',
              taskIds: [],
              acceptanceRefs: [],
            },
          ],
        },
      }),
    ).toThrow(/orphan package/u);
    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: {
          packages: [
            {
              ...base,
              writeScopes: [{ repositoryId: 'workspace', paths: ['../outside/**'] }],
            },
          ],
        },
      }),
    ).toThrow(/repository-relative/u);
    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: { packages: [{ ...base, acceptanceRefs: [] }] },
      }),
    ).toThrow(/acceptance criterion/u);
    expect(() =>
      createBuildPlan({
        runId: 'run-1',
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: {
          packages: [
            { ...base, packageKey: 'first', dependsOn: ['second'] },
            { ...base, packageKey: 'second', dependsOn: ['first'] },
          ],
        },
      }),
    ).toThrow(/dependency cycle/u);
  });

  it('requires RED/GREEN/regression only for TDD while direct still requires tests', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Implement it.\n  **Acceptance:** It works.\n',
    );
    const plan = createBuildPlan({
      runId: 'run-tdd',
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
            writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['tests-pass'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
        ],
      },
    });
    const input = {
      workPackage: plan.packages[0]!,
      executionId: 'execution-1',
      acceptanceEvidenceIds: ['acceptance-1'],
      repositoryDigest: sha('b'),
      implementationDigest: sha('c'),
    };

    expect(() =>
      createPackageCompletionEvidence({
        ...input,
        testEvidenceIds: ['test-1'],
        tddMode: 'tdd',
      }),
    ).toThrow(/RED, GREEN, and regression/u);
    expect(() =>
      createPackageCompletionEvidence({
        ...input,
        testEvidenceIds: [],
        tddMode: 'direct',
      }),
    ).toThrow(/acceptance and test Evidence/u);
    expect(
      createPackageCompletionEvidence({
        ...input,
        testEvidenceIds: ['test-1', 'regression-1'],
        tddMode: 'direct',
      }).tddEvidence,
    ).toBeNull();
  });

  it('requires bounded Build Check evidence and an independent standard reviewer', () => {
    const base = {
      configurationDigest: sha('a'),
      planDigest: sha('b'),
      repositoryDigest: sha('c'),
      implementationDigest: sha('d'),
      completedPackageIds: ['package-1'],
      acceptedTaskIds: ['1.1'],
      testEvidenceIds: ['test-1'],
      findings: [],
    } as const;
    expect(() =>
      createBuildCheckEvidence({
        ...base,
        review: {
          mode: 'standard',
          implementationExecutionId: 'same-execution',
          reviewerExecutionId: 'same-execution',
        },
      }),
    ).toThrow(/independent reviewer/u);
    expect(() =>
      createBuildCheckEvidence({
        ...base,
        testEvidenceIds: [],
        review: {
          mode: 'standard',
          implementationExecutionId: 'implementation-1',
          reviewerExecutionId: 'review-1',
        },
      }),
    ).toThrow(/test Evidence/u);
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
      advanceBuildProtocol(configured, { kind: 'retry', action: 'execute' }),
    ).toThrow(/current Runtime-selected Action/u);
    expect(() =>
      advanceBuildProtocol(
        configured,
        { kind: 'host-outcome', action: 'execute', accepted: true } as never,
      ),
    ).toThrow(/Unsupported Build protocol observation/u);
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
    const retry = advanceBuildProtocol(evidenced, { kind: 'retry', action: 'execute' });
    const completion = createPackageCompletionEvidence({
      workPackage: plan.packages[0]!,
      executionId: 'implementation-1',
      acceptanceEvidenceIds: ['acceptance-1'],
      testEvidenceIds: ['test-1'],
      tddMode: 'tdd',
      tddEvidence: {
        redEvidenceId: 'red-1',
        greenEvidenceId: 'green-1',
        regressionEvidenceId: 'regression-1',
      },
      repositoryDigest: sha('b'),
      implementationDigest: sha('c'),
    });
    const executed = advanceBuildProtocol(retry, { kind: 'package-completed', completion });
    const check = createBuildCheckEvidence({
      configurationDigest: configuration.semanticDigest,
      planDigest: plan.digest,
      repositoryDigest: sha('b'),
      implementationDigest: sha('c'),
      completedPackageIds: [plan.packages[0]!.packageId],
      acceptedTaskIds: ['1.1'],
      testEvidenceIds: ['test-1'],
      review: {
        mode: 'standard',
        implementationExecutionId: 'implementation-1',
        reviewerExecutionId: 'review-1',
      },
      findings: [],
    });
    const checked = advanceBuildProtocol(executed, { kind: 'check-accepted', evidence: check });

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
