import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  advanceBuildProtocol,
  assertPlanEvidence,
  assertBuildCheckEvidence,
  advanceBuildWorkspaceCheckpoint,
  assessBuildPlanRisk,
  canRetainSuspendedExecutionBinding,
  createBuildCheckEvidence,
  createBuildStrategy,
  createExecutionBinding,
  createBuildInvalidation,
  createBuildPlan as createBuildPlanV2,
  createBuildProtocolState,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
  createPackageCompletionEvidence,
  createPlanEvidence as createPlanEvidenceV2,
  createBuildPlanAuthorizationEnvelope,
  compareBuildPlanAuthorizationEnvelope,
  revalidateSuspendedBuildProtocol,
  suspendBuildProtocolForDesign,
  validateBuildPlan as validateBuildPlanV2,
  type WorkPackageCandidate,
} from '../domains/change-lifecycle/build-protocol.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';
import { createEvidenceDependencyRecord } from '../domains/evidence/dependencies.js';
import { hostAbsolutePath } from './helpers/host-path.js';

describe('Build workspace checkpoint', () => {
  it('uses host-native absolute checkout fixtures', () => {
    expect(path.isAbsolute(hostAbsolutePath('workspace'))).toBe(true);
  });

  it('separates immutable Binding identity from authorized repository progress', () => {
    const configuration = approvedConfiguration({ repositoryIds: ['app', 'worker'] });
    const state = advanceBuildProtocol(
      createBuildProtocolState({
        runId: 'run-checkpoint',
        planningDigest: sha('planning'),
        strategy: configuration.strategy,
      }),
      { kind: 'binding-accepted', binding: configuration.binding },
    );
    const initial = state.workspaceCheckpoint!;
    const observed = initial.repositories.map((repository) =>
      repository.repositoryId === 'app'
        ? { ...repository, headRevision: 'f'.repeat(40) }
        : repository,
    );
    const advanced = advanceBuildWorkspaceCheckpoint({
      current: initial,
      observed,
      writableRepositoryIds: ['app'],
      relations: { app: 'fast-forward', worker: 'unchanged' },
    });

    expect(advanced.revision).toBe(2);
    expect(advanced.digest).not.toBe(initial.digest);
    expect(configuration.binding.repositories[0]!.headRevision).not.toBe('f'.repeat(40));
    expect(JSON.stringify(advanced)).not.toMatch(/checkoutPath|C:\\\\/u);
  });

  it('rejects unauthorized and non-fast-forward repository progress', () => {
    const configuration = approvedConfiguration({ repositoryIds: ['app', 'worker'] });
    const configured = advanceBuildProtocol(
      createBuildProtocolState({
        runId: 'run-checkpoint-rejection',
        planningDigest: sha('planning'),
        strategy: configuration.strategy,
      }),
      { kind: 'binding-accepted', binding: configuration.binding },
    );
    const initial = configured.workspaceCheckpoint!;
    const observed = initial.repositories.map((repository) =>
      repository.repositoryId === 'worker'
        ? { ...repository, headRevision: 'e'.repeat(40) }
        : repository,
    );

    expect(() =>
      advanceBuildWorkspaceCheckpoint({
        current: initial,
        observed,
        writableRepositoryIds: ['app'],
        relations: { app: 'unchanged', worker: 'fast-forward' },
      }),
    ).toThrow(/outside the Package write scope/u);
    expect(() =>
      advanceBuildWorkspaceCheckpoint({
        current: initial,
        observed,
        writableRepositoryIds: ['worker'],
        relations: { app: 'unchanged', worker: 'non-fast-forward' },
      }),
    ).toThrow(/did not advance by fast-forward/u);
  });
});

const sha = (value: string): `sha256:${string}` => {
  const hex = Buffer.from(value).toString('hex') || '0';
  return `sha256:${hex.repeat(64).slice(0, 64)}`;
};

function nextWorkspaceCheckpoint(state: ReturnType<typeof createBuildProtocolState>) {
  const current = state.workspaceCheckpoint!;
  return advanceBuildWorkspaceCheckpoint({
    current,
    observed: current.repositories,
    writableRepositoryIds: current.repositories.map((repository) => repository.repositoryId),
    relations: Object.fromEntries(
      current.repositories.map((repository) => [repository.repositoryId, 'unchanged'] as const),
    ),
  });
}

function approvedConfiguration(
  options: {
    repositoryIds?: readonly string[];
    executionMode?: 'autonomous' | 'subagent-driven-development';
    tddMode?: 'tdd' | 'direct';
  } = {},
) {
  const repositoryIds = options.repositoryIds ?? ['workspace'];
  const executionMode = options.executionMode ?? 'autonomous';
  const intent = createExecutionWorkspaceIntent({
    workspaceId: 'team-platform',
    changeId: 'managed-build',
    isolation: 'worktree',
  });
  const binding = createExecutionWorkspaceBinding({
    intent,
    repositories: repositoryIds.map(
      (repositoryId, index) =>
        ({
          repositoryId,
          checkoutPath: hostAbsolutePath(`repoctopus-managed-build-${repositoryId}`),
          branch: 'codex/managed-build',
          head: `${index}`.padEnd(40, 'a'),
          worktreeId: `wt-managed-build-${repositoryId}`,
          workspaceOwned: true,
        }) as const,
    ),
  });
  const strategy = createBuildStrategy({
    runId: 'run-managed-build',
    revision: 1,
    executionMode,
    tddMode: options.tddMode ?? 'tdd',
    reviewMode: 'standard',
    isolationIntent: intent.isolation,
  });
  const executionBinding = createExecutionBinding({
    strategy,
    revision: 1,
    coordinatorHostId: 'codex-local',
    workspaceBinding: binding,
    workspaceOwnerId: intent.workspaceId,
    localOverlayRef: 'execution-workspace:test',
  });
  return {
    strategy,
    binding: executionBinding,
    intent,
    workspaceIntent: intent,
    semanticDigest: strategy.semanticDigest,
    bindingDigest: executionBinding.stateDigest,
    repositoryIds: executionBinding.repositories.map((entry) => entry.repositoryId),
    hostCapabilities: [
      executionMode === 'autonomous' ? 'build.autonomous' : 'subagent.dispatch.attested',
      'process.execute',
      'repository.read',
      'repository.write',
      'specification.read',
    ],
  };
}

type BuildFixture = ReturnType<typeof approvedConfiguration>;

type TestWorkPackageCandidate = Omit<
  WorkPackageCandidate,
  'sideEffectClass' | 'completionContract'
> &
  Partial<Pick<WorkPackageCandidate, 'sideEffectClass' | 'completionContract'>>;

function createBuildPlan(
  input: Omit<Parameters<typeof createBuildPlanV2>[0], 'strategy' | 'binding' | 'candidate'> & {
    configuration: BuildFixture;
    candidate: { packages: readonly TestWorkPackageCandidate[] };
  },
) {
  const { configuration, ...rest } = input;
  return createBuildPlanV2({
    ...rest,
    strategy: configuration.strategy,
    binding: configuration.binding,
    candidate: {
      packages: input.candidate.packages.map((candidate) => ({
        ...candidate,
        sideEffectClass: candidate.sideEffectClass ?? 'repository-write',
        completionContract:
          candidate.completionContract ??
          ({
            schemaVersion: 1,
            behaviorSlice: candidate.packageKey,
            requiredEvidence:
              configuration.strategy.tddMode === 'tdd'
                ? ['acceptance', 'implementation', 'red', 'green', 'regression']
                : ['acceptance', 'implementation', 'test', 'regression'],
          } as const),
      })),
    },
  });
}

function validateBuildPlan(
  input: Omit<
    Parameters<typeof validateBuildPlanV2>[0],
    'strategy' | 'binding' | 'protectedBranches'
  > & {
    configuration: BuildFixture;
    protectedBranches?: readonly string[];
  },
) {
  const { configuration, protectedBranches = [], ...rest } = input;
  return validateBuildPlanV2({
    ...rest,
    strategy: configuration.strategy,
    binding: configuration.binding,
    protectedBranches,
  });
}

function createPlanEvidence(
  input: Omit<
    Parameters<typeof createPlanEvidenceV2>[0],
    'strategy' | 'binding' | 'protectedBranches' | 'compositionCheckpointDigest' | 'reportOwnerId'
  > & { configuration: BuildFixture; protectedBranches?: readonly string[] },
) {
  const { configuration, protectedBranches = [], ...rest } = input;
  return createPlanEvidenceV2({
    ...rest,
    strategy: configuration.strategy,
    binding: configuration.binding,
    compositionCheckpointDigest: sha('c'),
    reportOwnerId: 'team-platform',
    protectedBranches,
  });
}

describe('Build protocol domain', () => {
  it('rejects a Package whose Outcome, Validator, and Evidence contract cannot close locally', () => {
    const configuration = approvedConfiguration({ tddMode: 'tdd' });
    const tasks = parseSpecificationTasks(
      'package-closure',
      '- [ ] 1.1 Implement the behavior.\n  **Acceptance:** The behavior passes.\n',
    );
    const acceptanceRefs = tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId);
    const candidate = {
      packageKey: 'behavior',
      taskIds: ['1.1'],
      repositoryIds: ['workspace'],
      writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
      acceptanceRefs,
      expectedOutcomes: ['behavior-passes'],
      validatorProfile: 'build.package-valid',
      dependsOn: [] as string[],
      sideEffectClass: 'repository-write' as const,
      completionContract: {
        schemaVersion: 1 as const,
        behaviorSlice: 'behavior-1',
        requiredEvidence: ['acceptance', 'implementation', 'red', 'green'] as const,
      },
    };
    const plan = createBuildPlan({
      runId: 'run-package-closure',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: { packages: [candidate] },
    });

    const validation = validateBuildPlan({ plan, configuration, tasks });

    expect(validation.accepted).toBe(false);
    expect(validation.findings).toContainEqual(
      expect.objectContaining({
        code: 'package-evidence-incomplete',
        packageIds: [plan.packages[0]!.packageId],
      }),
    );
  });

  it('rejects RED and GREEN split across independently completable TDD Packages', () => {
    const configuration = approvedConfiguration({ tddMode: 'tdd' });
    const tasks = parseSpecificationTasks(
      'tdd-slice',
      '- [ ] 1.1 Implement one behavior slice.\n  **Acceptance:** The slice passes.\n',
    );
    const acceptanceRefs = tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId);
    const base = {
      taskIds: ['1.1'],
      repositoryIds: ['workspace'],
      writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
      acceptanceRefs,
      expectedOutcomes: ['slice-passes'],
      validatorProfile: 'build.package-valid',
      dependsOn: [] as string[],
      sideEffectClass: 'repository-write' as const,
    };
    const plan = createBuildPlan({
      runId: 'run-tdd-slice',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            ...base,
            packageKey: 'red-only',
            completionContract: {
              schemaVersion: 1,
              behaviorSlice: 'slice-1',
              requiredEvidence: ['acceptance', 'red'],
            },
          },
          {
            ...base,
            packageKey: 'green-only',
            completionContract: {
              schemaVersion: 1,
              behaviorSlice: 'slice-1',
              requiredEvidence: ['implementation', 'green', 'regression'],
            },
          },
        ],
      },
    });

    const validation = validateBuildPlan({ plan, configuration, tasks });

    expect(validation.accepted).toBe(false);
    expect(validation.findings.map((finding) => finding.code)).toContain('tdd-slice-split');
  });

  it('accepts a complete TDD behavior slice and a complete direct-mode slice', () => {
    for (const tddMode of ['tdd', 'direct'] as const) {
      const configuration = approvedConfiguration({ tddMode });
      const tasks = parseSpecificationTasks(
        `complete-${tddMode}`,
        '- [ ] 1.1 Implement one behavior slice.\n  **Acceptance:** The slice passes.\n',
      );
      const requiredEvidence =
        tddMode === 'tdd'
          ? (['acceptance', 'implementation', 'red', 'green', 'regression'] as const)
          : (['acceptance', 'implementation', 'test', 'regression'] as const);
      const plan = createBuildPlan({
        runId: `run-complete-${tddMode}`,
        revision: 1,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: {
          packages: [
            {
              packageKey: 'complete-slice',
              taskIds: ['1.1'],
              repositoryIds: ['workspace'],
              writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
              acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
              expectedOutcomes: ['slice-passes'],
              validatorProfile: 'build.package-valid',
              dependsOn: [],
              sideEffectClass: 'repository-write',
              completionContract: {
                schemaVersion: 1,
                behaviorSlice: 'slice-1',
                requiredEvidence,
              },
            },
          ],
        },
      });

      expect(validateBuildPlan({ plan, configuration, tasks })).toMatchObject({
        accepted: true,
        findings: [],
      });
    }
  });

  it('requires a Human Decision only when a Plan revision expands its authorization envelope', () => {
    const configuration = approvedConfiguration({
      repositoryIds: ['workspace', 'backend'],
      tddMode: 'direct',
    });
    const tasks = parseSpecificationTasks(
      'authorization-envelope',
      '- [ ] 1.1 Implement the bounded behavior.\n  **Acceptance:** The bounded behavior passes.\n',
    );
    const packageCandidate = (overrides: Record<string, unknown> = {}) => ({
      packageKey: 'bounded',
      taskIds: ['1.1'],
      repositoryIds: ['workspace'],
      writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
      acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
      expectedOutcomes: ['bounded-passes'],
      validatorProfile: 'build.package-valid',
      dependsOn: [] as string[],
      sideEffectClass: 'repository-write' as const,
      completionContract: {
        schemaVersion: 1 as const,
        behaviorSlice: 'bounded-1',
        requiredEvidence: ['acceptance', 'implementation', 'test', 'regression'] as const,
      },
      ...overrides,
    });
    const create = (revision: number, packages: ReturnType<typeof packageCandidate>[]) =>
      createBuildPlan({
        runId: 'run-authorization-envelope',
        revision,
        configuration,
        planningDigest: tasks.digest,
        tasks,
        candidate: { packages },
      });
    const approved = create(1, [packageCandidate()]);
    const equivalent = create(2, [
      packageCandidate({
        expectedOutcomes: ['bounded-passes-with-equivalent-command'],
        completionContract: {
          schemaVersion: 1,
          behaviorSlice: 'bounded-1',
          requiredEvidence: ['regression', 'test', 'implementation', 'acceptance'],
        },
      }),
    ]);
    const expandedRepository = create(2, [
      packageCandidate({
        repositoryIds: ['workspace', 'backend'],
        writeScopes: [
          { repositoryId: 'workspace', paths: ['src/**'] },
          { repositoryId: 'backend', paths: ['src/**'] },
        ],
      }),
    ]);
    const expandedWriteScope = create(2, [
      packageCandidate({
        writeScopes: [{ repositoryId: 'workspace', paths: ['src/**', 'infra/**'] }],
      }),
    ]);
    const expandedSideEffect = create(2, [packageCandidate({ sideEffectClass: 'git-publish' })]);
    const envelope = createBuildPlanAuthorizationEnvelope(approved);

    expect(compareBuildPlanAuthorizationEnvelope(envelope, equivalent)).toMatchObject({
      requiresDecision: false,
      expansions: [],
    });
    for (const candidate of [expandedRepository, expandedWriteScope, expandedSideEffect]) {
      expect(compareBuildPlanAuthorizationEnvelope(envelope, candidate).requiresDecision).toBe(
        true,
      );
    }
  });

  it('rejects protected branches only for repositories in the exact Plan write set', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team-platform',
      changeId: 'protected-write-set',
      isolation: 'current',
    });
    const workspaceBinding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'backend',
          checkoutPath: hostAbsolutePath('backend'),
          branch: 'main',
          head: '1'.repeat(40),
          worktreeId: null,
          workspaceOwned: true,
        },
        {
          repositoryId: 'web-design',
          checkoutPath: hostAbsolutePath('web-design'),
          branch: 'main',
          head: '2'.repeat(40),
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });
    const strategy = createBuildStrategy({
      runId: 'run-protected-write-set',
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: intent.isolation,
    });
    const binding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'codex-local',
      workspaceBinding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:protected-write-set',
    });
    const tasks = parseSpecificationTasks(
      'protected-write-set',
      '- [ ] 1.1 Update the web design fixture.\n  **Acceptance:** The fixture exposes blocked state.\n',
    );
    const plan = createBuildPlanV2({
      runId: 'run-protected-write-set',
      revision: 1,
      strategy,
      binding,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'web-design',
            taskIds: ['1.1'],
            repositoryIds: ['backend', 'web-design'],
            writeScopes: [{ repositoryId: 'web-design', paths: ['src/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['blocked-state-is-exposed'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
            sideEffectClass: 'repository-write',
            completionContract: {
              schemaVersion: 1,
              behaviorSlice: 'web-design',
              requiredEvidence: ['acceptance', 'implementation', 'red', 'green', 'regression'],
            },
          },
        ],
      },
    });

    const rejected = validateBuildPlanV2({
      plan,
      strategy,
      binding,
      tasks,
      protectedBranches: ['main', 'release/*'],
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.protectedBranchPolicyDigest).toMatch(/^sha256:/u);
    expect(rejected.diagnostics).toHaveLength(1);
    expect(rejected.diagnostics[0]).toMatch(/web-design.*main.*prepare and publish/iu);

    const sourceBinding = createExecutionBinding({
      strategy,
      revision: 2,
      coordinatorHostId: 'codex-local',
      workspaceBinding: createExecutionWorkspaceBinding({
        intent,
        repositories: [
          workspaceBinding.repositories[0]!,
          { ...workspaceBinding.repositories[1]!, branch: 'codex/blocked-status' },
        ],
      }),
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:protected-write-set-source',
    });
    const sourcePlan = createBuildPlanV2({
      runId: plan.runId,
      revision: 2,
      strategy,
      binding: sourceBinding,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: plan.packages.map((workPackage) => ({
          packageKey: workPackage.packageKey,
          taskIds: workPackage.taskIds,
          repositoryIds: workPackage.repositoryIds,
          writeScopes: workPackage.writeScopes,
          acceptanceRefs: workPackage.acceptanceRefs,
          expectedOutcomes: workPackage.expectedOutcomes,
          validatorProfile: workPackage.validatorProfile,
          dependsOn: [],
          sideEffectClass: workPackage.sideEffectClass,
          completionContract: workPackage.completionContract,
        })),
      },
    });
    expect(
      validateBuildPlanV2({
        plan: sourcePlan,
        strategy,
        binding: sourceBinding,
        tasks,
        protectedBranches: ['main', 'release/*'],
      }),
    ).toMatchObject({ accepted: true, diagnostics: [] });
  });
  it('suspends Design-revision candidates without making them runnable and revalidates by layer', () => {
    const configuration = approvedConfiguration();
    let state = createBuildProtocolState({
      runId: 'run-suspended-design',
      planningDigest: sha('a'),
      strategy: configuration.strategy,
    });
    state = advanceBuildProtocol(state, {
      kind: 'binding-accepted',
      binding: configuration.binding,
    });

    const suspended = suspendBuildProtocolForDesign(state, {
      observedPlanningDigest: sha('b'),
      reasonCode: 'semantic-drift',
      invalidatedIdentities: ['planning-semantic', 'build-plan'],
    });
    expect(suspended).toMatchObject({
      status: 'suspended-for-design',
      currentAction: null,
      binding: { bindingId: configuration.binding.bindingId },
      suspension: { supersededPlanningDigest: sha('a'), observedPlanningDigest: sha('b') },
    });
    expect(() => advanceBuildProtocol(suspended, { kind: 'retry', action: 'plan' })).toThrow(
      /suspended/iu,
    );
    expect(
      canRetainSuspendedExecutionBinding(suspended, {
        strategy: configuration.strategy,
        repositoryIds: configuration.binding.repositories.map((entry) => entry.repositoryId),
      }),
    ).toBe(true);
    expect(
      canRetainSuspendedExecutionBinding(suspended, {
        strategy: configuration.strategy,
        repositoryIds: [
          ...configuration.binding.repositories.map((entry) => entry.repositoryId),
          'new-repository',
        ],
      }),
    ).toBe(false);

    const revalidated = revalidateSuspendedBuildProtocol(suspended, {
      planningDigest: sha('b'),
      strategy: configuration.strategy,
      bindingCompatible: true,
      planCompatible: false,
      retainedPackageIds: [],
    });
    expect(revalidated).toMatchObject({
      status: 'active',
      currentAction: 'plan',
      planningDigest: sha('b'),
      binding: { bindingId: configuration.binding.bindingId },
      plan: null,
      suspension: null,
    });
  });

  it.each([
    ['single-repository', ['workspace']],
    ['multi-repository', ['workspace', 'worker']],
  ] as const)(
    'retains only unaffected completion evidence and repository bindings in a %s revision',
    (_label, repositoryIds) => {
      const configuration = approvedConfiguration({ repositoryIds, tddMode: 'direct' });
      const originalTasks = parseSpecificationTasks(
        'managed-build',
        '- [ ] 1.1 Preserve the stable package.\n  **Acceptance:** Stable behavior remains.\n- [ ] 1.2 Revise the changed package.\n  **Acceptance:** Changed behavior works.\n',
      );
      const packageCandidate = (taskIndex: number, expectedOutcome: string) => {
        const repositoryId = repositoryIds[Math.min(taskIndex, repositoryIds.length - 1)]!;
        return {
          packageKey: `package-${taskIndex + 1}`,
          taskIds: [originalTasks.tasks[taskIndex]!.taskId],
          repositoryIds: [repositoryId],
          writeScopes: [{ repositoryId, paths: [`src/package-${taskIndex + 1}/**`] }],
          acceptanceRefs: originalTasks.tasks[taskIndex]!.acceptanceCriteria.map(
            (criterion) => criterion.acceptanceId,
          ),
          expectedOutcomes: [expectedOutcome],
          validatorProfile: 'build.package-valid',
          dependsOn: [] as string[],
        };
      };
      const firstPlan = createBuildPlan({
        runId: 'run-local-revalidation',
        revision: 1,
        configuration,
        planningDigest: originalTasks.digest,
        tasks: originalTasks,
        candidate: {
          packages: [packageCandidate(0, 'stable-output'), packageCandidate(1, 'old-output')],
        },
      });
      let state = createBuildProtocolState({
        runId: 'run-local-revalidation',
        planningDigest: originalTasks.digest,
        strategy: configuration.strategy,
      });
      state = advanceBuildProtocol(state, {
        kind: 'binding-accepted',
        binding: configuration.binding,
      });
      state = advanceBuildProtocol(state, {
        kind: 'plan-accepted',
        plan: firstPlan,
        workspaceCheckpoint: nextWorkspaceCheckpoint(state),
      });
      state = advanceBuildProtocol(state, {
        kind: 'plan-evidence-accepted',
        evidence: createPlanEvidence({
          plan: firstPlan,
          configuration,
          validation: validateBuildPlan({ plan: firstPlan, configuration, tasks: originalTasks }),
        }),
      });
      for (const [index, workPackage] of firstPlan.packages.entries()) {
        state = advanceBuildProtocol(state, {
          kind: 'package-completed',
          completion: createPackageCompletionEvidence({
            workPackage,
            executionId: `execution-${index + 1}`,
            acceptanceEvidenceIds: [`acceptance-${index + 1}`],
            testEvidenceIds: [`test-${index + 1}`],
            tddMode: 'direct',
            workspaceCheckpointDigest: nextWorkspaceCheckpoint(state).digest,
            implementationDigest: sha(String(index + 3)),
          }),
          workspaceCheckpoint: nextWorkspaceCheckpoint(state),
        });
      }

      const revisedTasks = parseSpecificationTasks(
        'managed-build',
        '- [ ] 1.1 Preserve the stable package.\n  **Acceptance:** Stable behavior remains.\n- [ ] 1.2 Revise the changed package with stricter behavior.\n  **Acceptance:** Changed behavior works.\n',
      );
      state = revalidateSuspendedBuildProtocol(
        suspendBuildProtocolForDesign(state, {
          observedPlanningDigest: revisedTasks.digest,
          reasonCode: 'semantic-drift',
          invalidatedIdentities: ['planning-semantic', 'build-plan'],
        }),
        {
          planningDigest: revisedTasks.digest,
          strategy: configuration.strategy,
          bindingCompatible: true,
          planCompatible: false,
          retainedPackageIds: firstPlan.packages.map((workPackage) => workPackage.packageId),
        },
      );
      const revisedPlan = createBuildPlan({
        runId: 'run-local-revalidation',
        revision: 2,
        configuration,
        planningDigest: revisedTasks.digest,
        tasks: revisedTasks,
        candidate: {
          packages: [
            {
              ...packageCandidate(0, 'stable-output'),
              acceptanceRefs: revisedTasks.tasks[0]!.acceptanceCriteria.map(
                (criterion) => criterion.acceptanceId,
              ),
            },
            {
              ...packageCandidate(1, 'new-output'),
              taskIds: [revisedTasks.tasks[1]!.taskId],
              acceptanceRefs: revisedTasks.tasks[1]!.acceptanceCriteria.map(
                (criterion) => criterion.acceptanceId,
              ),
            },
          ],
        },
      });
      state = advanceBuildProtocol(state, {
        kind: 'plan-accepted',
        plan: revisedPlan,
        workspaceCheckpoint: nextWorkspaceCheckpoint(state),
      });

      expect(state.packageCompletions).toHaveLength(1);
      expect(state.packageCompletions[0]?.packageId).toBe(revisedPlan.packages[0]?.packageId);
      expect(state.binding?.bindingId).toBe(configuration.binding.bindingId);
      expect(state.binding?.repositories.map((entry) => entry.repositoryId)).toEqual(
        [...repositoryIds].sort(),
      );
      expect(revisedPlan.packages[1]?.repositoryIds).toEqual([
        repositoryIds[Math.min(1, repositoryIds.length - 1)],
      ]);
      expect(state.currentAction).toBe('plan-evidence');
    },
  );

  it('changes package identity for Task revisions and propagates dependency identity changes', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Build the foundation.\n  **Acceptance:** Foundation works.\n- [ ] 1.2 Integrate the feature.\n  **Acceptance:** Integration works.\n',
    );
    const candidate = {
      packages: [
        {
          packageKey: 'foundation',
          taskIds: ['1.1'],
          repositoryIds: ['workspace'],
          writeScopes: [{ repositoryId: 'workspace', paths: ['src/foundation/**'] }],
          acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
          expectedOutcomes: ['foundation-ready'],
          validatorProfile: 'build.package-valid',
          dependsOn: [] as string[],
        },
        {
          packageKey: 'integration',
          taskIds: ['1.2'],
          repositoryIds: ['workspace'],
          writeScopes: [{ repositoryId: 'workspace', paths: ['src/integration/**'] }],
          acceptanceRefs: tasks.tasks[1]!.acceptanceCriteria.map((item) => item.acceptanceId),
          expectedOutcomes: ['integration-ready'],
          validatorProfile: 'build.package-valid',
          dependsOn: ['foundation'],
        },
      ],
    };
    const original = createBuildPlan({
      runId: 'run-package-identity',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate,
    });
    const revisedTasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Build the hardened foundation.\n  **Acceptance:** Foundation works.\n- [ ] 1.2 Integrate the feature.\n  **Acceptance:** Integration works.\n',
    );
    const revised = createBuildPlan({
      runId: 'run-package-identity',
      revision: 2,
      configuration,
      planningDigest: revisedTasks.digest,
      tasks: revisedTasks,
      candidate: {
        packages: candidate.packages.map((workPackage, index) => ({
          ...workPackage,
          acceptanceRefs: revisedTasks.tasks[index]!.acceptanceCriteria.map(
            (item) => item.acceptanceId,
          ),
        })),
      },
    });
    expect(revised.packages[0]!.digest).not.toBe(original.packages[0]!.digest);
    expect(revised.packages[1]!.digest).not.toBe(original.packages[1]!.digest);

    const detached = createBuildPlan({
      runId: 'run-package-identity',
      revision: 3,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: candidate.packages.map((workPackage) =>
          workPackage.packageKey === 'integration'
            ? { ...workPackage, dependsOn: [] }
            : workPackage,
        ),
      },
    });
    expect(detached.packages[0]!.digest).toBe(original.packages[0]!.digest);
    expect(detached.packages[1]!.digest).not.toBe(original.packages[1]!.digest);
  });

  it('normalizes workspace and configuration input into stable immutable digests', () => {
    const first = approvedConfiguration();
    const second = approvedConfiguration();

    expect(first.semanticDigest).toBe(second.semanticDigest);
    expect(first.strategy.strategyId).toBe(second.strategy.strategyId);
    expect(first.bindingDigest).toBe(second.bindingDigest);
    expect(() => {
      (first.binding.repositories as unknown as Array<{ repositoryId: string }>).push({
        repositoryId: 'unsafe',
      });
    }).toThrow();

    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team-platform',
      changeId: 'managed-build',
      isolation: 'worktree',
    });
    const repository = {
      repositoryId: 'workspace',
      checkoutPath: hostAbsolutePath('repoctopus-managed-build-workspace'),
      branch: 'codex/managed-build',
      head: '0'.padEnd(40, 'a'),
      worktreeId: 'wt-managed-build-workspace',
      workspaceOwned: true,
    };
    const before = createExecutionWorkspaceBinding({ intent, repositories: [repository] });
    const afterCommit = createExecutionWorkspaceBinding({
      intent,
      repositories: [{ ...repository, head: '1'.padEnd(40, 'b') }],
    });
    expect(afterCommit.semanticDigest).toBe(before.semanticDigest);
    expect(afterCommit.localDigest).toBe(before.localDigest);
    expect(afterCommit.stateDigest).not.toBe(before.stateDigest);
  });

  it('rejects unsupported profiles while keeping Host capabilities out of Binding identity', () => {
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
          checkoutPath: hostAbsolutePath('repoctopus'),
          branch: 'main',
          head: '0123456789abcdef0123456789abcdef01234567',
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });

    const strategy = createBuildStrategy({
      runId: 'run-invalid',
      revision: 1,
      executionMode: 'subagent-driven-development',
      tddMode: 'direct',
      reviewMode: 'standard',
      isolationIntent: 'current',
    });
    const executionBinding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'plain-host',
      workspaceBinding: binding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:test',
    });
    expect(executionBinding).toMatchObject({
      schemaVersion: 3,
      coordinatorHostId: 'plain-host',
    });
    expect(JSON.stringify(executionBinding)).not.toContain('capabilit');
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

  it('fails Plan preflight closed for tampered Task, acceptance, repository, scope and digest facts', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Implement the bounded change.\n  **Acceptance:** Bounded behavior passes.\n',
    );
    const plan = createBuildPlan({
      runId: 'run-preflight',
      revision: 1,
      configuration,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'bounded',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['bounded-tests-pass'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
        ],
      },
    });
    const variants = [
      { ...plan, packages: [{ ...plan.packages[0]!, taskIds: ['missing-task'] }] },
      { ...plan, packages: [{ ...plan.packages[0]!, acceptanceRefs: ['missing-acceptance'] }] },
      { ...plan, packages: [{ ...plan.packages[0]!, repositoryIds: ['unbound'] }] },
      {
        ...plan,
        packages: [
          {
            ...plan.packages[0]!,
            writeScopes: [{ repositoryId: 'unbound', paths: ['outside/**'] }],
          },
        ],
      },
      { ...plan, digest: sha('f') },
    ];
    for (const candidate of variants) {
      const validation = validateBuildPlanV2({
        plan: candidate,
        strategy: configuration.strategy,
        binding: configuration.binding,
        tasks,
        protectedBranches: [],
      });
      expect(validation.accepted).toBe(false);
      expect(() =>
        createPlanEvidenceV2({
          plan: candidate,
          strategy: configuration.strategy,
          binding: configuration.binding,
          validation,
          protectedBranches: [],
          compositionCheckpointDigest: sha('c'),
          reportOwnerId: 'team-platform',
        }),
      ).toThrow(/Rejected Build Plan/iu);
    }
  });

  it('binds Plan Evidence to Host, scopes, dependencies, validators and terminal report ownership', () => {
    const configuration = approvedConfiguration();
    const tasks = parseSpecificationTasks(
      'managed-build',
      '- [ ] 1.1 Implement it.\n  **Acceptance:** It passes.\n',
    );
    const plan = createBuildPlan({
      runId: 'run-plan-evidence',
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
            writeScopes: [{ repositoryId: 'workspace', paths: ['domains/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map((item) => item.acceptanceId),
            expectedOutcomes: ['tests-pass'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
          },
        ],
      },
    });
    const validation = validateBuildPlan({ plan, configuration, tasks });
    const evidence = createPlanEvidence({ plan, configuration, validation });
    expect(evidence).toMatchObject({
      taskIds: ['1.1'],
      validatorProfiles: ['build.package-valid'],
      reviewMode: 'standard',
      reportOwnerId: 'team-platform',
    });
    expect(evidence.acceptanceRefs).toEqual(plan.packages[0]!.acceptanceRefs);
    expect(evidence.writeScopeDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(evidence.dependencyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() =>
      assertPlanEvidence({
        ...evidence,
        dependencies: createEvidenceDependencyRecord({
          ...evidence.dependencies,
          dependencies: [{ partition: 'implementation-content', identity: sha('forged') }],
        }),
      }),
    ).toThrow(/modified/u);
    expect(() =>
      createPlanEvidenceV2({
        plan,
        strategy: configuration.strategy,
        binding: configuration.binding,
        validation,
        protectedBranches: [],
        compositionCheckpointDigest: sha('c'),
        reportOwnerId: ' ',
      }),
    ).toThrow(/report owner/iu);
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
      strategy: configuration.strategy,
    });
    state = advanceBuildProtocol(state, {
      kind: 'binding-accepted',
      binding: configuration.binding,
    });
    state = advanceBuildProtocol(state, {
      kind: 'plan-accepted',
      plan: plan1,
      workspaceCheckpoint: nextWorkspaceCheckpoint(state),
    });
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
      workspaceCheckpointDigest: nextWorkspaceCheckpoint(state).digest,
      implementationDigest: sha('c'),
    });
    state = advanceBuildProtocol(state, {
      kind: 'package-completed',
      completion: modelCompletion,
      workspaceCheckpoint: nextWorkspaceCheckpoint(state),
    });
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
    state = advanceBuildProtocol(state, {
      kind: 'plan-accepted',
      plan: plan2,
      workspaceCheckpoint: nextWorkspaceCheckpoint(state),
    });

    expect(state.plans).toHaveLength(2);
    expect(state.packageCompletions).toEqual([modelCompletion]);
    expect(state.invalidations).toEqual([invalidation]);
    expect(plan2.packages[0]!.packageId).toBe(plan1.packages[0]!.packageId);
    expect(plan2.packages[1]!.packageId).not.toBe(plan1.packages[1]!.packageId);

    const dependencyInvalidation = createBuildInvalidation({
      source: 'verify',
      plan: plan1,
      classification: 'implementation',
      affectedPackageIds: [plan1.packages[0]!.packageId],
      packageCompletions: [modelCompletion],
      reason: 'The model changed and every dependent package must be rechecked',
    });
    expect(dependencyInvalidation.affectedPackageIds).toEqual(
      plan1.packages.map((workPackage) => workPackage.packageId).sort(),
    );
    expect(dependencyInvalidation.retainedCompletionIds).toEqual([]);
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
      workspaceCheckpointDigest: sha('b'),
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
      strategyDigest: sha('a'),
      bindingStateDigest: sha('e'),
      planDigest: sha('b'),
      workspaceCheckpointDigest: sha('c'),
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
      strategy: configuration.strategy,
    });
    expect(initial.currentAction).toBe('configure');
    const configured = advanceBuildProtocol(initial, {
      kind: 'binding-accepted',
      binding: configuration.binding,
    });
    expect(configured.currentAction).toBe('plan');
    expect(() => advanceBuildProtocol(configured, { kind: 'retry', action: 'execute' })).toThrow(
      /current Runtime-selected Action/u,
    );
    expect(() =>
      advanceBuildProtocol(configured, {
        kind: 'host-outcome',
        action: 'execute',
        accepted: true,
      } as never),
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
      strategy: configuration.strategy,
    });
    const configured = advanceBuildProtocol(initial, {
      kind: 'binding-accepted',
      binding: configuration.binding,
    });
    const planned = advanceBuildProtocol(configured, {
      kind: 'plan-accepted',
      plan,
      workspaceCheckpoint: nextWorkspaceCheckpoint(configured),
    });
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
      workspaceCheckpointDigest: nextWorkspaceCheckpoint(retry).digest,
      implementationDigest: sha('c'),
    });
    const executed = advanceBuildProtocol(retry, {
      kind: 'package-completed',
      completion,
      workspaceCheckpoint: nextWorkspaceCheckpoint(retry),
    });
    const check = createBuildCheckEvidence({
      strategyDigest: configuration.strategy.semanticDigest,
      bindingStateDigest: configuration.binding.stateDigest,
      planDigest: plan.digest,
      workspaceCheckpointDigest: executed.workspaceCheckpoint!.digest,
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
    expect(() =>
      assertBuildCheckEvidence({
        ...check,
        dependencies: createEvidenceDependencyRecord({
          ...check.dependencies,
          dependencies: [{ partition: 'implementation-content', identity: sha('forged') }],
        }),
      }),
    ).toThrow(/modified/u);
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

  it('revalidates compatible machine drift without changing Strategy or discarding completions', () => {
    const configuration = approvedConfiguration();
    const initial = createBuildProtocolState({
      runId: 'run-binding-drift',
      planningDigest: sha('a'),
      strategy: configuration.strategy,
    });
    const configured = advanceBuildProtocol(initial, {
      kind: 'binding-accepted',
      binding: configuration.binding,
    });
    const drifted = advanceBuildProtocol(configured, {
      kind: 'binding-revalidation-required',
      reasonCode: 'head',
    });
    expect(drifted).toMatchObject({
      currentAction: 'configure',
      status: 'active',
      strategy: { strategyId: configuration.strategy.strategyId },
      binding: null,
      plan: null,
      planEvidence: null,
      checkEvidence: null,
    });
    expect(drifted.bindingHistory).toEqual([configuration.binding]);
    expect(drifted.invalidations).toEqual([]);
  });
});
