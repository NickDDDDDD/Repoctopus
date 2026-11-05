import { describe, expect, it } from 'vitest';

import {
  CHANGE_PHASES,
  applyChangeLifecycleTransition,
  assertChangeLifecycleSnapshot,
  evolveChangeLifecycle,
  projectChangeRun,
  type ChangeLifecycleDefinition,
  type ChangeLifecycleSnapshot,
  type ChangeRunBlocker,
  type RunStatus,
  type WaitCondition,
  type WorkDescriptor,
} from '../domains/change-lifecycle/transition.js';
import type { SpecificationTask } from '../domains/specification/types.js';
import type { VerificationInput } from '../domains/change-lifecycle/verification-input.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import {
  advanceBuildProtocol,
  advanceBuildWorkspaceCheckpoint,
  createBuildCheckEvidence,
  createBuildStrategy,
  createExecutionBinding,
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
import { applyLifecycleRecoveryDecision } from '../domains/change-lifecycle/recovery.js';
import { classifyRecoveryObservation } from '../domains/runtime/recovery.js';

const digest = (value: string): `sha256:${string}` => {
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

const strategyFor = (intent: ReturnType<typeof createExecutionWorkspaceIntent>) =>
  createBuildStrategy({
    runId: initialSnapshot().identity.runId,
    revision: 1,
    executionMode: 'autonomous',
    tddMode: 'tdd',
    reviewMode: 'standard',
    isolationIntent: intent.isolation,
  });

const definition: ChangeLifecycleDefinition = {
  schemaVersion: 3,
  id: 'repoctopus-change',
  version: '1.0.0',
  phases: CHANGE_PHASES.map((phase) => ({
    phase,
    workKinds: [`${phase}.work`],
    requiredValidatorProfiles: [`${phase}.validator`],
    extensionCheckpoints: [`after-${phase}`],
  })),
  works: structuredClone(BUILTIN_CHANGE_LIFECYCLE_DEFINITION.works),
  buildProtocol: structuredClone(BUILTIN_CHANGE_LIFECYCLE_DEFINITION.buildProtocol),
  transitions: [
    {
      id: 'open.ready',
      kind: 'advance',
      from: { phase: 'open', statuses: ['running'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'intake-ready',
      requiredValidatorProfile: 'open.validator',
    },
    {
      id: 'design.await-approval',
      kind: 'self',
      from: { phase: 'design', statuses: ['running'] },
      to: { phase: 'design', status: 'waiting' },
      trigger: 'planning-valid',
      requiredValidatorProfile: 'design.validator',
    },
    {
      id: 'design.approved',
      kind: 'advance',
      from: { phase: 'design', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'approval-accepted',
    },
    {
      id: 'build.validated',
      kind: 'advance',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'verify', status: 'running' },
      trigger: 'all-tasks-validated',
      requiredValidatorProfile: 'build.validator',
    },
    {
      id: 'build.plan-drift',
      kind: 'fallback',
      from: { phase: 'build', statuses: ['running', 'blocked'] },
      to: { phase: 'design', status: 'blocked' },
      trigger: 'planning-semantic-drift',
    },
    {
      id: 'verify.failed',
      kind: 'fallback',
      from: { phase: 'verify', statuses: ['running'] },
      to: { phase: 'build', status: 'blocked' },
      trigger: 'verification-failed',
      requiredValidatorProfile: 'verify.validator',
    },
    {
      id: 'verify.passed',
      kind: 'advance',
      from: { phase: 'verify', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'verification-passed',
      requiredValidatorProfile: 'verify.validator',
    },
    {
      id: 'archive.await-merges',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'waiting' },
      trigger: 'business-mrs-published',
    },
    {
      id: 'archive.completed',
      kind: 'complete',
      from: { phase: 'archive', statuses: ['waiting', 'running'] },
      to: { phase: 'archive', status: 'completed' },
      trigger: 'change-closed-and-final-mr-ready',
      requiredValidatorProfile: 'archive.validator',
    },
  ],
};

function initialSnapshot(
  overrides: Partial<ChangeLifecycleSnapshot> = {},
): ChangeLifecycleSnapshot {
  return {
    schemaVersion: 2,
    identity: {
      workspaceId: 'team-platform',
      changeId: 'establish-change-lifecycle',
      runId: 'change-run-1',
    },
    definition: {
      id: definition.id,
      version: definition.version,
      digest: digest('d'),
    },
    revision: 0,
    checkEpoch: 0,
    phase: 'open',
    status: 'running',
    currentWork: null,
    waitCondition: null,
    blocker: null,
    ...overrides,
  };
}

function builtinSnapshot(
  overrides: Partial<ChangeLifecycleSnapshot> = {},
): ChangeLifecycleSnapshot {
  return {
    ...createChangeLifecycleSnapshot({ identity: initialSnapshot().identity }),
    status: 'running',
    ...overrides,
  };
}

function approvalWait(): WaitCondition {
  return {
    schemaVersion: 1,
    waitId: 'wait-design-approval',
    kind: 'human-decision',
    reason: 'Planning artifacts need a trusted decision.',
    inputDigest: digest('i'),
    requestId: 'decision-1',
    proposalDigest: digest('p'),
  };
}

function mergeWait(): WaitCondition {
  return {
    schemaVersion: 1,
    waitId: 'wait-business-merges',
    kind: 'external-fact',
    reason: 'The complete Business MR set has not merged.',
    inputDigest: digest('i'),
    providerId: 'merge-request-provider',
    factIdentityDigest: digest('m'),
  };
}

function blocker(status: RunStatus): ChangeRunBlocker {
  return {
    code: `change.${status}`,
    message: `Change is ${status}`,
    evidenceIds: ['evidence-1'],
    sinceRevision: 0,
  };
}

const cleared = { currentWork: null, waitCondition: null, blocker: null } as const;

const buildTask: SpecificationTask = {
  taskId: '1.1',
  taskRevision: digest('t'),
  title: 'Build it',
  level: 0,
  status: 'pending',
  completion: null,
  blockedBy: [],
  acceptanceCriteria: [],
  requirementRefs: [],
};

const buildWork: WorkDescriptor = {
  schemaVersion: 2,
  workId: 'build:1.1:test',
  checkEpoch: 4,
  phase: 'build',
  kind: 'task.implement',
  taskId: buildTask.taskId,
  taskRevision: buildTask.taskRevision,
  augmentationSkills: [],
  methodProfile: {
    id: 'build',
    version: '1.0.0',
    digest: digest('m'),
    sourceDigests: [],
    ruleIds: [],
  },
  capabilities: ['repository.write'],
  sideEffectClass: 'repository-write',
  writeScopes: [],
  inputDigest: digest('i'),
  outputContract: { artifactKinds: [], trackerPublish: false },
  validatorProfile: { id: 'build.task-valid', version: '1.0.0', digest: digest('v') },
  authorizationSource: {
    kind: 'lifecycle-definition',
    definitionId: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.id,
    definitionVersion: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
  },
  checkpoint: 'build.before-task',
};

function phaseWork(
  phase: WorkDescriptor['phase'],
  kind: WorkDescriptor['kind'],
  checkEpoch: number,
  inputDigest: `sha256:${string}`,
): WorkDescriptor {
  const base = structuredClone(buildWork);
  delete base.taskId;
  delete base.taskRevision;
  return {
    ...base,
    workId: `${phase}:${kind}:${checkEpoch}`,
    checkEpoch,
    phase,
    kind,
    inputDigest,
  };
}

function verificationInput(checkEpoch: number, value: string): VerificationInput {
  return {
    schemaVersion: 3,
    runId: initialSnapshot().identity.runId,
    checkEpoch,
    taskRevisions: [{ taskId: buildTask.taskId, taskRevision: buildTask.taskRevision }],
    acceptanceCriteria: [],
    acceptanceSetHash: digest('a'),
    acceptanceCoverage: [],
    repositories: [
      {
        repositoryId: 'workspace',
        commit: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        dirtyFilesDigest: digest('c'),
        inputPolicyDigest: digest('i'),
        controlPlaneInputDigest: digest('h'),
      },
    ],
    projectConfigDigest: digest('p'),
    compositionDigest: digest('c'),
    skills: [],
    evidenceProfile: {
      id: 'verify',
      planDigest: digest('e'),
      fingerprintDigest: `fingerprint-${value}`,
    },
    digest: digest(value),
  };
}

function recoveryExecutionFixture() {
  const tasks = parseSpecificationTasks(
    'continue-build',
    '- [ ] 1.1 Implement retryable behavior.\n  **Acceptance:** Retryable behavior passes.\n',
  );
  const intent = createExecutionWorkspaceIntent({
    workspaceId: initialSnapshot().identity.workspaceId,
    changeId: initialSnapshot().identity.changeId,
    isolation: 'current',
  });
  const workspaceBinding = createExecutionWorkspaceBinding({
    intent,
    repositories: [
      {
        repositoryId: 'workspace',
        checkoutPath: 'C:\\workspace',
        branch: 'main',
        head: '1'.repeat(40),
        worktreeId: null,
        workspaceOwned: true,
      },
    ],
  });
  const strategy = createBuildStrategy({
    runId: initialSnapshot().identity.runId,
    revision: 1,
    executionMode: 'autonomous',
    tddMode: 'direct',
    reviewMode: 'standard',
    isolationIntent: intent.isolation,
  });
  const binding = createExecutionBinding({
    strategy,
    revision: 1,
    coordinatorHostId: 'runtime-host',
    workspaceBinding,
    workspaceOwnerId: intent.workspaceId,
    localOverlayRef: 'execution-workspace:continue',
  });
  const plan = createBuildPlan({
    runId: initialSnapshot().identity.runId,
    revision: 1,
    strategy,
    binding,
    planningDigest: tasks.digest,
    tasks,
    candidate: {
      packages: [
        {
          packageKey: 'retryable-package',
          taskIds: ['1.1'],
          repositoryIds: ['workspace'],
          writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
          acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map(
            (criterion) => criterion.acceptanceId,
          ),
          expectedOutcomes: ['retryable-behavior-passes'],
          validatorProfile: 'build.package-valid',
          dependsOn: [],
          sideEffectClass: 'repository-write',
          completionContract: {
            schemaVersion: 1,
            behaviorSlice: 'retryable-package',
            requiredEvidence: ['acceptance', 'implementation', 'test', 'regression'],
          },
        },
      ],
    },
  });
  let protocol = createBuildProtocolState({
    runId: initialSnapshot().identity.runId,
    planningDigest: tasks.digest,
    strategy,
  });
  protocol = advanceBuildProtocol(protocol, { kind: 'binding-accepted', binding });
  protocol = advanceBuildProtocol(protocol, {
    kind: 'plan-accepted',
    plan,
    workspaceCheckpoint: nextWorkspaceCheckpoint(protocol),
  });
  protocol = advanceBuildProtocol(protocol, {
    kind: 'plan-evidence-accepted',
    evidence: createPlanEvidence({
      plan,
      strategy,
      binding,
      validation: validateBuildPlan({
        plan,
        strategy,
        binding,
        tasks,
        protectedBranches: [],
      }),
      protectedBranches: [],
      compositionCheckpointDigest: digest('composition'),
      reportOwnerId: 'team-platform',
    }),
  });
  return { tasks, intent, strategy, binding, plan, protocol };
}

describe('Change lifecycle domain', () => {
  it('atomically materializes revise-design from a Runtime recovery decision', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'current',
    });
    const protocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: digest('approved-plan'),
      strategy: createBuildStrategy({
        runId: initialSnapshot().identity.runId,
        revision: 1,
        executionMode: 'autonomous',
        tddMode: 'tdd',
        reviewMode: 'standard',
        isolationIntent: intent.isolation,
      }),
    });
    const current = builtinSnapshot({
      revision: 7,
      checkEpoch: 3,
      phase: 'build',
      currentWork: phaseWork('build', 'build.configure', 3, digest('configure')),
      planningDigest: digest('approved-plan'),
      workspaceIntent: intent,
      buildProtocol: protocol,
    });
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId: current.identity.runId,
      expectedRevision: current.revision,
      checkEpoch: current.checkEpoch,
      observationId: 'planning-observation-1',
      planning: {
        status: 'drift',
        reasonCode: 'requirements-changed',
        changedIdentities: ['planning-semantic'],
      },
      plan: { status: 'current', changedIdentities: [] },
      work: { status: 'current', changedIdentities: [] },
      evidence: { status: 'current', changedIdentities: [] },
    });
    if (!decision) throw new Error('expected revise-design decision');
    const designWork = phaseWork('design', 'specification.plan', 4, digest('observed-plan'));

    const applied = applyLifecycleRecoveryDecision({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      decision,
      materialization: {
        work: designWork,
        inputDigest: designWork.inputDigest,
        evidenceIds: ['planning:observation-1'],
      },
    });

    expect(applied.snapshot).toMatchObject({
      revision: 8,
      checkEpoch: 4,
      phase: 'design',
      status: 'running',
      currentWork: { workId: designWork.workId, kind: 'specification.plan' },
      buildProtocol: { status: 'suspended-for-design', currentAction: null },
    });
    expect(applied.snapshot.planningDigest).toBeUndefined();
    expect(applied.fact).toMatchObject({
      recovery: {
        decisionId: decision.decisionId,
        action: 'revise-design',
        authority: 'planning',
        invalidatedIdentities: decision.invalidatedIdentities,
      },
    });
  });

  it('atomically materializes revise-plan while retaining unaffected completion', () => {
    const tasks = parseSpecificationTasks(
      'recovery-plan',
      '- [ ] 1.1 Change package A.\n  **Acceptance:** Package A passes.\n- [ ] 1.2 Keep package B.\n  **Acceptance:** Package B passes.\n',
    );
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'current',
    });
    const workspaceBinding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: 'C:\\workspace',
          branch: 'main',
          head: '1'.repeat(40),
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });
    const strategy = createBuildStrategy({
      runId: initialSnapshot().identity.runId,
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'direct',
      reviewMode: 'standard',
      isolationIntent: intent.isolation,
    });
    const binding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'runtime-host',
      workspaceBinding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:recovery',
    });
    const plan = createBuildPlan({
      runId: initialSnapshot().identity.runId,
      revision: 1,
      strategy,
      binding,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: tasks.tasks.map((task, index) => ({
          packageKey: `package-${index + 1}`,
          taskIds: [task.taskId],
          repositoryIds: ['workspace'],
          writeScopes: [{ repositoryId: 'workspace', paths: [`src/${index + 1}/**`] }],
          acceptanceRefs: task.acceptanceCriteria.map((criterion) => criterion.acceptanceId),
          expectedOutcomes: [`package-${index + 1}-passes`],
          validatorProfile: 'build.package-valid',
          dependsOn: [],
          sideEffectClass: 'repository-write' as const,
          completionContract: {
            schemaVersion: 1 as const,
            behaviorSlice: `package-${index + 1}`,
            requiredEvidence: ['acceptance', 'implementation', 'test', 'regression'] as const,
          },
        })),
      },
    });
    let protocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: tasks.digest,
      strategy,
    });
    protocol = advanceBuildProtocol(protocol, { kind: 'binding-accepted', binding });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'plan-accepted',
      plan,
      workspaceCheckpoint: nextWorkspaceCheckpoint(protocol),
    });
    const planEvidence = createPlanEvidence({
      plan,
      strategy,
      binding,
      validation: validateBuildPlan({
        plan,
        strategy,
        binding,
        tasks,
        protectedBranches: [],
      }),
      protectedBranches: [],
      compositionCheckpointDigest: digest('composition'),
      reportOwnerId: 'team-platform',
    });
    protocol = advanceBuildProtocol(protocol, { kind: 'plan-evidence-accepted', evidence: planEvidence });
    for (const [index, workPackage] of plan.packages.entries()) {
      const checkpoint = advanceBuildWorkspaceCheckpoint({
        current: protocol.workspaceCheckpoint!,
        observed: protocol.workspaceCheckpoint!.repositories,
        writableRepositoryIds: ['workspace'],
        relations: { workspace: 'unchanged' },
      });
      protocol = advanceBuildProtocol(protocol, {
        kind: 'package-completed',
        completion: createPackageCompletionEvidence({
          workPackage,
          executionId: `execution-${index + 1}`,
          acceptanceEvidenceIds: [`acceptance-${index + 1}`],
          testEvidenceIds: [`test-${index + 1}`],
          tddMode: 'direct',
          workspaceCheckpointDigest: checkpoint.digest,
          implementationDigest: digest(`implementation-${index + 1}`),
        }),
        workspaceCheckpoint: checkpoint,
      });
    }
    const invalidation = createBuildInvalidation({
      source: 'build-check',
      plan,
      classification: 'planning',
      affectedPackageIds: [plan.packages[0]!.packageId],
      packageCompletions: protocol.packageCompletions,
      reason: 'Package A is not independently completable.',
    });
    const current = builtinSnapshot({
      revision: 11,
      checkEpoch: 9,
      phase: 'build',
      currentWork: phaseWork('build', 'build.check', 9, digest('check')),
      planningDigest: tasks.digest,
      workspaceIntent: intent,
      buildProtocol: protocol,
    });
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId: current.identity.runId,
      expectedRevision: current.revision,
      checkEpoch: current.checkEpoch,
      observationId: 'plan-observation-1',
      planning: { status: 'current', changedIdentities: [] },
      plan: {
        status: 'drift',
        reasonCode: 'package-not-completable',
        changedIdentities: ['build-plan'],
      },
      work: { status: 'current', changedIdentities: [] },
      evidence: { status: 'current', changedIdentities: [] },
    });
    if (!decision) throw new Error('expected revise-plan decision');
    const planWork = phaseWork('build', 'build.plan', 10, invalidation.digest);

    const applied = applyLifecycleRecoveryDecision({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      decision,
      materialization: { work: planWork, invalidation, evidenceIds: [] },
    });

    expect(applied.snapshot).toMatchObject({
      revision: 12,
      checkEpoch: 10,
      phase: 'build',
      status: 'running',
      currentWork: { workId: planWork.workId, kind: 'build.plan' },
      buildProtocol: { currentAction: 'plan', status: 'active', plan: { planId: plan.planId } },
    });
    expect(applied.snapshot.buildProtocol?.packageCompletions.map((entry) => entry.packageId)).toEqual([
      plan.packages[1]!.packageId,
    ]);
    expect(applied.fact).toMatchObject({
      recovery: { decisionId: decision.decisionId, action: 'revise-plan', authority: 'plan' },
    });
  });

  it('continues the same Build Work and Plan at a new attempt checkpoint', () => {
    const fixture = recoveryExecutionFixture();
    const executeWork = phaseWork('build', 'build.execute', 6, digest('execute'));
    const current = builtinSnapshot({
      revision: 8,
      checkEpoch: 6,
      phase: 'build',
      currentWork: executeWork,
      tasks: fixture.tasks.tasks,
      planningDigest: fixture.tasks.digest,
      workspaceIntent: fixture.intent,
      buildProtocol: fixture.protocol,
    });
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId: current.identity.runId,
      expectedRevision: current.revision,
      checkEpoch: current.checkEpoch,
      observationId: 'retry-observation-1',
      planning: { status: 'current', changedIdentities: [] },
      plan: { status: 'current', changedIdentities: [] },
      work: {
        status: 'retryable',
        reasonCode: 'execution-interrupted',
        changedIdentities: ['execution-checkpoint'],
      },
      evidence: { status: 'current', changedIdentities: [] },
    });
    if (!decision) throw new Error('expected continue-build decision');

    const applied = applyLifecycleRecoveryDecision({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      decision,
      materialization: { work: executeWork, evidenceIds: ['attempt:1'] },
    });

    expect(applied.snapshot).toMatchObject({
      revision: 9,
      checkEpoch: 6,
      phase: 'build',
      currentWork: { workId: executeWork.workId, checkEpoch: executeWork.checkEpoch },
      buildProtocol: {
        currentAction: 'execute',
        actionAttempt: 2,
        plan: { planId: fixture.plan.planId, revision: fixture.plan.revision },
      },
    });
    expect(applied.fact).toMatchObject({
      from: { checkEpoch: 6 },
      to: { checkEpoch: 6 },
      recovery: { action: 'continue-build', decisionId: decision.decisionId },
    });
  });

  it('invalidates only Verify evidence and resumes the nearest legal producer', () => {
    const fixture = recoveryExecutionFixture();
    const checkpoint = advanceBuildWorkspaceCheckpoint({
      current: fixture.protocol.workspaceCheckpoint!,
      observed: fixture.protocol.workspaceCheckpoint!.repositories,
      writableRepositoryIds: ['workspace'],
      relations: { workspace: 'unchanged' },
    });
    let protocol = advanceBuildProtocol(fixture.protocol, {
      kind: 'package-completed',
      completion: createPackageCompletionEvidence({
        workPackage: fixture.plan.packages[0]!,
        executionId: 'execution-1',
        acceptanceEvidenceIds: ['acceptance-1'],
        testEvidenceIds: ['test-1'],
        tddMode: 'direct',
        workspaceCheckpointDigest: checkpoint.digest,
        implementationDigest: digest('implementation'),
      }),
      workspaceCheckpoint: checkpoint,
    });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'check-accepted',
      evidence: createBuildCheckEvidence({
        strategyDigest: fixture.strategy.semanticDigest,
        bindingStateDigest: fixture.binding.stateDigest,
        planDigest: fixture.plan.digest,
        workspaceCheckpointDigest: protocol.workspaceCheckpoint!.digest,
        implementationDigest: digest('implementation'),
        completedPackageIds: [fixture.plan.packages[0]!.packageId],
        acceptedTaskIds: ['1.1'],
        testEvidenceIds: ['build-check-test'],
        review: {
          mode: 'standard',
          implementationExecutionId: 'execution-1',
          reviewerExecutionId: 'reviewer-1',
        },
        findings: [],
      }),
    });
    const priorInput = {
      ...verificationInput(9, 'verify-prior'),
      taskRevisions: fixture.tasks.tasks.map(({ taskId, taskRevision }) => ({ taskId, taskRevision })),
    };
    const current = builtinSnapshot({
      revision: 12,
      checkEpoch: 9,
      phase: 'verify',
      currentWork: phaseWork('verify', 'evidence.verify', 9, priorInput.digest),
      tasks: fixture.tasks.tasks,
      planningDigest: fixture.tasks.digest,
      workspaceIntent: fixture.intent,
      buildProtocol: protocol,
      verificationInput: priorInput,
    });
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId: current.identity.runId,
      expectedRevision: current.revision,
      checkEpoch: current.checkEpoch,
      observationId: 'evidence-observation-1',
      planning: { status: 'current', changedIdentities: [] },
      plan: { status: 'current', changedIdentities: [] },
      work: { status: 'current', changedIdentities: [] },
      evidence: {
        status: 'drift',
        reasonCode: 'receipt-input-changed',
        changedIdentities: ['verification-input'],
      },
    });
    if (!decision) throw new Error('expected invalidate-evidence decision');
    const nextInput = { ...priorInput, checkEpoch: 10, digest: digest('verify-next') };
    const nextWork = phaseWork('verify', 'evidence.verify', 10, nextInput.digest);

    const applied = applyLifecycleRecoveryDecision({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      decision,
      materialization: {
        work: nextWork,
        verificationInput: nextInput,
        evidenceIds: ['receipt:changed'],
      },
    });

    expect(applied.snapshot).toMatchObject({
      revision: 13,
      checkEpoch: 10,
      phase: 'verify',
      currentWork: { workId: nextWork.workId, kind: 'evidence.verify' },
      verificationInput: { digest: nextInput.digest },
      buildProtocol: {
        status: 'ready-for-verify',
        plan: { planId: fixture.plan.planId },
        packageCompletions: [{ packageId: fixture.plan.packages[0]!.packageId }],
      },
    });
    expect(applied.fact).toMatchObject({
      transitionId: 'verify.retry',
      recovery: { action: 'invalidate-evidence', authority: 'evidence' },
    });
  });

  it('atomically replaces a rejected Open checkpoint with one revision-bound repair Work', () => {
    const current: ChangeLifecycleSnapshot = {
      ...createChangeLifecycleSnapshot({ identity: initialSnapshot().identity }),
      revision: 4,
      checkEpoch: 4,
      phase: 'open',
      status: 'blocked',
      currentWork: null,
      waitCondition: null,
      blocker: {
        code: 'open.planning-invalid',
        message: 'Task acceptance is missing',
        evidenceIds: [digest('e')],
        sinceRevision: 4,
      },
      openApprovalDigest: digest('a'),
    };
    const repairWork = phaseWork('open', 'change.intake', 5, digest('r'));
    const observation = {
      kind: 'open-repair-required' as const,
      expectedRevision: 4,
      source: 'strict-validation' as const,
      reasonCode: 'strict-validation-invalid' as const,
      evidenceIds: [digest('e')],
      inputDigest: digest('r'),
      work: repairWork,
    };

    const repaired = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      observation,
    });

    expect(repaired.snapshot).toMatchObject({
      revision: 5,
      checkEpoch: 5,
      phase: 'open',
      status: 'running',
      currentWork: { workId: repairWork.workId, kind: 'change.intake', checkEpoch: 5 },
      waitCondition: null,
      blocker: null,
    });
    expect(repaired.snapshot).not.toHaveProperty('openApprovalDigest');
    expect(repaired.snapshot.openApprovalInvalidated).toBe(true);
    expect(repaired.fact).toMatchObject({
      transitionId: 'open.repair-required',
      openRepair: {
        source: 'strict-validation',
        reasonCode: 'strict-validation-invalid',
        previousCheckEpoch: 4,
        nextCheckEpoch: 5,
      },
    });

    expect(
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: repaired.snapshot,
        observation,
      }).fact,
    ).toBeNull();
    expect(() =>
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: repaired.snapshot,
        observation: {
          ...observation,
          work: phaseWork('open', 'change.intake', 6, digest('s')),
        },
      }),
    ).toThrow('stale lifecycle revision');
  });

  it.each([
    ['provider-artifacts', 'provider-artifacts-invalid'],
    ['strict-validation', 'strict-validation-invalid'],
    ['lifecycle-validator', 'lifecycle-validator-rejected'],
    ['approval-drift', 'approval-drift'],
  ] as const)('accepts bounded %s Open repair sources only', (source, reasonCode) => {
    const current = createChangeLifecycleSnapshot({ identity: initialSnapshot().identity });
    const work = phaseWork('open', 'change.intake', 1, digest('r'));
    const repaired = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      observation: {
        kind: 'open-repair-required',
        expectedRevision: current.revision,
        source,
        reasonCode,
        evidenceIds: [digest('e')],
        inputDigest: digest('r'),
        work,
      },
    });
    expect(repaired.snapshot.currentWork?.workId).toBe(work.workId);
  });

  it('owns Open and Design gate decisions in the canonical reducer', () => {
    const { taskId, taskRevision, ...workWithoutTask } = buildWork;
    void taskId;
    void taskRevision;
    const openWork: WorkDescriptor = {
      ...workWithoutTask,
      workId: 'open:intake',
      checkEpoch: 0,
      phase: 'open',
      kind: 'change.intake',
      inputDigest: digest('o'),
      validatorProfile: {
        id: 'open.intake-ready',
        version: '1.0.0',
        digest: digest('v'),
      },
    };
    const designWork: WorkDescriptor = {
      ...workWithoutTask,
      workId: 'design:plan',
      checkEpoch: 2,
      phase: 'design',
      kind: 'specification.plan',
      inputDigest: digest('p'),
      validatorProfile: {
        id: 'design.artifacts-valid',
        version: '1.0.0',
        digest: digest('v'),
      },
    };
    const openWaiting = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: {
        ...createChangeLifecycleSnapshot({ identity: initialSnapshot().identity }),
        currentWork: openWork,
      },
      observation: {
        kind: 'open-gate',
        result: 'waiting',
        reason: 'Review complete Open baseline',
        evidenceIds: [digest('e')],
        inputDigest: digest('o'),
        requestId: 'open-decision-1',
        proposalDigest: digest('q'),
      },
    });
    expect(openWaiting.snapshot).toMatchObject({ phase: 'open', status: 'waiting' });
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'current',
    });
    const intentSelected = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: openWaiting.snapshot,
      observation: {
        kind: 'open-workspace-intent-selected',
        intent,
        requestId: 'open-decision-1',
        proposalDigest: digest('q'),
        actorId: 'trusted-user',
      },
    });
    const opened = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: intentSelected.snapshot,
      observation: {
        kind: 'open-gate',
        result: 'approved',
        reason: 'Open baseline approved',
        evidenceIds: [digest('e')],
        inputDigest: digest('o'),
        work: {
          ...designWork,
          checkEpoch: intentSelected.snapshot.checkEpoch + 1,
        },
      },
    });
    expect(opened.snapshot).toMatchObject({ phase: 'design', status: 'running' });

    const waiting = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: opened.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'waiting',
        reason: 'Trusted Human Decision required',
        evidenceIds: [digest('e')],
        inputDigest: digest('i'),
        requestId: 'decision-1',
        proposalDigest: digest('p'),
      },
    });
    expect(waiting.snapshot).toMatchObject({
      phase: 'design',
      status: 'waiting',
      waitCondition: { kind: 'human-decision', requestId: 'decision-1' },
    });
    expect(
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: waiting.snapshot,
        observation: {
          kind: 'design-gate',
          result: 'waiting',
          reason: 'Trusted Human Decision required',
          evidenceIds: [digest('e')],
          inputDigest: digest('i'),
          requestId: 'decision-1',
          proposalDigest: digest('p'),
        },
      }).fact,
    ).toBeNull();

    const configureWork = phaseWork(
      'build',
      'build.configure',
      waiting.snapshot.checkEpoch + 1,
      digest('b'),
    );
    const buildProtocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: digest('i'),
      strategy: strategyFor(intent),
    });
    const approved = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: waiting.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'approved',
        reason: 'Trusted decision accepted',
        evidenceIds: [digest('e')],
        inputDigest: digest('i'),
        tasks: [buildTask],
        work: configureWork,
        buildProtocol,
      },
    });
    expect(approved.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      currentWork: { workId: configureWork.workId, kind: 'build.configure' },
      planningDigest: digest('i'),
    });

    const invalidated = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: approved.snapshot,
      observation: {
        kind: 'planning-authority-invalidated',
        expectedRevision: approved.snapshot.revision,
        fromPhase: 'build',
        invalidationKind: 'semantic',
        reason: 'Design artifact changed',
        evidenceIds: [digest('n')],
        inputDigest: digest('f'),
        work: phaseWork(
          'design',
          'specification.plan',
          approved.snapshot.checkEpoch + 1,
          digest('f'),
        ),
      },
    });
    expect(invalidated.snapshot).toMatchObject({
      phase: 'design',
      status: 'running',
      currentWork: { kind: 'specification.plan' },
      tasks: [{ taskId: buildTask.taskId }],
      buildProtocol: {
        status: 'suspended-for-design',
        currentAction: null,
        suspension: {
          supersededPlanningDigest: digest('i'),
          observedPlanningDigest: digest('f'),
        },
      },
    });
    expect(invalidated.snapshot.planningDigest).toBeUndefined();
    const recovered = JSON.parse(JSON.stringify(invalidated.snapshot)) as ChangeLifecycleSnapshot;
    expect(() => assertChangeLifecycleSnapshot(recovered)).not.toThrow();
    expect(recovered.currentWork?.kind).toBe('specification.plan');
    expect(recovered.buildProtocol?.currentAction).toBeNull();
    expect(invalidated.fact).toMatchObject({
      transitionId: 'build.semantic-plan-drift',
      invalidation: {
        kind: 'planning-authority-invalidated',
        invalidationKind: 'semantic',
        supersededPlanningDigest: digest('i'),
        observedPlanningDigest: digest('f'),
        supersededWorkId: configureWork.workId,
        supersededTaskRevisions: [buildTask.taskRevision],
        evidenceIds: [digest('n')],
      },
    });

    expect(() =>
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: approved.snapshot,
        observation: {
          kind: 'planning-authority-invalidated',
          expectedRevision: approved.snapshot.revision - 1,
          fromPhase: 'build',
          invalidationKind: 'semantic',
          reason: 'Stale observation',
          evidenceIds: [],
          inputDigest: digest('f'),
          work: phaseWork(
            'design',
            'specification.plan',
            approved.snapshot.checkEpoch + 1,
            digest('f'),
          ),
        },
      }),
    ).toThrow(/stale lifecycle revision/u);

    const blocked = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: opened.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'blocked',
        reason: 'Strict validation failed',
        evidenceIds: [digest('v')],
        inputDigest: digest('v'),
      },
    });
    expect(blocked.snapshot).toMatchObject({
      phase: 'design',
      status: 'blocked',
      currentWork: null,
      blocker: { code: 'design.planning-invalid' },
    });
  });

  it('advances only through declared phases and completes inside Archive', () => {
    let state = initialSnapshot();
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'open.ready',
      next: cleared,
    }).snapshot;
    expect(state).toMatchObject({ phase: 'design', status: 'running', revision: 1 });
    expect(state.checkEpoch).toBe(1);

    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'design.await-approval',
      next: { ...cleared, waitCondition: approvalWait() },
    }).snapshot;
    expect(state).toMatchObject({ phase: 'design', status: 'waiting', revision: 2 });
    expect(state.checkEpoch).toBe(2);

    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'design.approved',
      next: cleared,
    }).snapshot;
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'build.validated',
      next: cleared,
    }).snapshot;
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'verify.passed',
      next: cleared,
    }).snapshot;
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'archive.await-merges',
      next: { ...cleared, waitCondition: mergeWait() },
    }).snapshot;
    const completed = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'archive.completed',
      next: cleared,
    });

    expect(completed.snapshot).toMatchObject({
      phase: 'archive',
      status: 'completed',
      revision: 7,
      checkEpoch: 7,
    });
    expect(completed.fact).toMatchObject({
      transitionId: 'archive.completed',
      from: { phase: 'archive', status: 'waiting' },
      to: { phase: 'archive', status: 'completed' },
      waitId: null,
    });
  });

  it('rejects an undeclared phase jump without changing the current snapshot', () => {
    const current = initialSnapshot();
    const before = structuredClone(current);

    expect(() =>
      applyChangeLifecycleTransition({
        definition,
        current,
        transitionId: 'design.approved',
        next: cleared,
      }),
    ).toThrow('design.approved is not valid from open/running');
    expect(current).toEqual(before);
    expect(() =>
      applyChangeLifecycleTransition({
        definition,
        current: initialSnapshot({
          revision: Number.MAX_SAFE_INTEGER,
          checkEpoch: Number.MAX_SAFE_INTEGER,
        }),
        transitionId: 'open.ready',
        next: cleared,
      }),
    ).toThrow(/cannot overflow/u);
  });

  it('keeps bounded Build failure, Verify retry, and Archive reverify in one Run', () => {
    const designRevisionIntent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'current',
    });
    const activeBuildProtocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: digest('p'),
      strategy: strategyFor(designRevisionIntent),
    });
    const activeBuild = builtinSnapshot({
      revision: 4,
      checkEpoch: 4,
      phase: 'build',
      currentWork: buildWork,
      tasks: [buildTask],
      planningDigest: digest('p'),
      workspaceIntent: designRevisionIntent,
      buildProtocol: activeBuildProtocol,
    });
    const exhausted = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: activeBuild,
      observation: {
        kind: 'build-retry-exhausted',
        workId: buildWork.workId,
        attempt: 3,
        reason: 'Three bounded attempts failed',
      },
    });
    expect(exhausted.snapshot).toMatchObject({
      phase: 'build',
      status: 'blocked',
      checkEpoch: 5,
      currentWork: null,
      blocker: { code: 'build.retry-exhausted' },
    });

    const verifyInput = verificationInput(5, 'v');
    const verifyWork = phaseWork('verify', 'evidence.verify', 5, verifyInput.digest);
    const activeVerify = builtinSnapshot({
      revision: 5,
      checkEpoch: 5,
      phase: 'verify',
      currentWork: verifyWork,
      tasks: [{ ...buildTask, status: 'completed' }],
      planningDigest: digest('p'),
      verificationInput: verifyInput,
    });
    const retryInput = verificationInput(6, 'r');
    const retryWork = phaseWork('verify', 'evidence.verify', 6, retryInput.digest);
    const retried = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: activeVerify,
      observation: {
        kind: 'verify-gate-rejected',
        workId: verifyWork.workId,
        inputDigest: verifyInput.digest,
        evidenceInputFingerprint: verifyInput.evidenceProfile.fingerprintDigest,
        attemptId: 'attempt-2',
        bundleId: null,
        reason: 'Evidence infrastructure unavailable',
        result: 'evidence-unavailable',
        checkEpoch: 5,
        verificationInput: retryInput,
        work: retryWork,
      },
    });
    expect(retried.snapshot).toMatchObject({
      phase: 'verify',
      status: 'running',
      checkEpoch: 6,
      currentWork: { workId: retryWork.workId },
    });

    const reverifyInput = verificationInput(7, 'z');
    const reverifyWork = phaseWork('verify', 'evidence.verify', 7, reverifyInput.digest);
    const reverified = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 6,
        checkEpoch: 6,
        phase: 'archive',
        tasks: [{ ...buildTask, status: 'completed' }],
        planningDigest: digest('p'),
        verificationInput: verifyInput,
      }),
      observation: {
        kind: 'archive-reverify-required',
        reason: 'Repository fingerprint changed before Archive side effects',
        verificationInput: reverifyInput,
        work: reverifyWork,
      },
    });
    expect(reverified.snapshot).toMatchObject({
      phase: 'verify',
      status: 'running',
      checkEpoch: 7,
      currentWork: { workId: reverifyWork.workId },
    });
    expect(reverified.snapshot.identity.runId).toBe(activeVerify.identity.runId);
  });

  it('retries Build Configure without leaving Build when Host capability evidence is incomplete', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'worktree',
    });
    const protocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: digest('p'),
      strategy: strategyFor(intent),
    });
    const configureWork = phaseWork('build', 'build.configure', 4, digest('c'));
    const retryWork = phaseWork('build', 'build.configure', 5, digest('r'));

    const retried = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 4,
        checkEpoch: 4,
        phase: 'build',
        currentWork: configureWork,
        tasks: [buildTask],
        workspaceIntent: intent,
        planningDigest: digest('p'),
        buildProtocol: protocol,
      }),
      observation: {
        kind: 'build-binding-retry-required',
        reason: 'The Configure Host did not attest the selected execution capability.',
        work: retryWork,
      },
    });

    expect(retried.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      checkEpoch: 5,
      currentWork: { workId: retryWork.workId, kind: 'build.configure' },
      tasks: [{ taskId: buildTask.taskId }],
      buildProtocol: { currentAction: 'configure', actionAttempt: 2 },
    });
    expect(retried.fact).toMatchObject({ transitionId: 'build.binding-retry' });
  });

  it('returns an unapproved Build Configure to an Open workspace-intent revision wait', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'current',
    });
    const protocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: digest('p'),
      strategy: strategyFor(intent),
    });
    const configureWork = phaseWork('build', 'build.configure', 4, digest('c'));

    const revision = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 4,
        checkEpoch: 4,
        phase: 'build',
        currentWork: configureWork,
        tasks: [buildTask],
        workspaceIntent: intent,
        planningDigest: digest('p'),
        buildProtocol: protocol,
      }),
      observation: {
        kind: 'workspace-intent-revision-required',
        requestId: 'workspace-intent-revision-1',
        proposalDigest: digest('r'),
        reason: 'Current isolation cannot bind a linked worktree.',
        evidenceIds: ['binding-error-1'],
        errorCode: 'current-linked-worktree',
        previousIsolation: 'current',
      } as never,
    });

    expect(revision.snapshot).toMatchObject({
      phase: 'open',
      status: 'waiting',
      checkEpoch: 5,
      currentWork: null,
      tasks: [],
      waitCondition: {
        kind: 'human-decision',
        waitId: 'workspace-intent:workspace-intent-revision-1',
        requestId: 'workspace-intent-revision-1',
        proposalDigest: digest('r'),
      },
    });
    expect(revision.snapshot).not.toHaveProperty('workspaceIntent');
    expect(revision.snapshot).not.toHaveProperty('buildProtocol');
    expect(revision.snapshot).not.toHaveProperty('planningDigest');
    expect(revision.fact).toMatchObject({
      transitionId: 'build.workspace-intent-revision-required',
      workspaceIntentRevision: {
        errorCode: 'current-linked-worktree',
        previousIsolation: 'current',
      },
    });

    const duplicate = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: revision.snapshot,
      observation: {
        kind: 'workspace-intent-revision-required',
        requestId: 'workspace-intent-revision-1',
        proposalDigest: digest('r'),
        reason: 'Current isolation cannot bind a linked worktree.',
        evidenceIds: ['binding-error-1'],
        errorCode: 'current-linked-worktree',
        previousIsolation: 'current',
      },
    });
    expect(duplicate.fact).toBeNull();
    expect(duplicate.snapshot).toEqual(revision.snapshot);

    const replacementIntent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'worktree',
    });
    const designWork = phaseWork('design', 'specification.plan', 6, digest('d'));
    const revised = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: revision.snapshot,
      observation: {
        kind: 'workspace-intent-revised',
        requestId: 'workspace-intent-revision-1',
        proposalDigest: digest('r'),
        actorId: 'trusted-user',
        intent: replacementIntent,
        work: designWork,
      } as never,
    });

    expect(revised.snapshot).toMatchObject({
      phase: 'design',
      status: 'running',
      checkEpoch: 6,
      workspaceIntent: replacementIntent,
      currentWork: { workId: designWork.workId, kind: 'specification.plan' },
      waitCondition: null,
    });
    expect(revised.snapshot.identity.runId).toBe(revision.snapshot.identity.runId);
    expect(revised.fact).toMatchObject({
      transitionId: 'open.workspace-intent-revised',
      workspaceIntentRevision: {
        previousIsolation: 'current',
        nextIsolation: 'worktree',
      },
    });
  });

  it('retries Build Plan without accepting an invalid Outcome', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'worktree',
    });
    const binding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: 'C:\\workspace',
          branch: 'main',
          head: '1'.repeat(40),
          worktreeId: 'dashboard-worktree',
          workspaceOwned: true,
        },
      ],
    });
    const strategy = createBuildStrategy({
      runId: initialSnapshot().identity.runId,
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: intent.isolation,
    });
    const executionBinding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'external:cli:codex-root',
      workspaceBinding: binding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:test',
    });
    let protocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: digest('p'),
      strategy,
    });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'binding-accepted',
      binding: executionBinding,
    });
    const retryWork = phaseWork('build', 'build.plan', 6, digest('b'));

    const retried = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 5,
        checkEpoch: 5,
        phase: 'build',
        currentWork: null,
        tasks: [buildTask],
        workspaceIntent: intent,
        planningDigest: digest('p'),
        buildProtocol: protocol,
      }),
      observation: {
        kind: 'build-plan-retry-required',
        reason: 'The Plan Outcome failed deterministic validation.',
        work: retryWork,
      },
    });

    expect(retried.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      checkEpoch: 6,
      currentWork: { workId: retryWork.workId, kind: 'build.plan' },
      buildProtocol: { currentAction: 'plan', actionAttempt: 2 },
    });
    expect(retried.fact).toMatchObject({ transitionId: 'build.plan-retry' });

    const migrationRequired = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: retried.snapshot,
      observation: {
        kind: 'work-execution-migration-required',
        reason: 'The legacy terminal Outcome cannot be proven compatible.',
        evidenceIds: ['legacy-outcome-1'],
      },
    });
    expect(migrationRequired.snapshot).toMatchObject({
      phase: 'build',
      status: 'migration_required',
      currentWork: null,
      blocker: {
        code: 'work-execution.migration-required',
        evidenceIds: ['legacy-outcome-1'],
      },
    });
    expect(migrationRequired.fact).toMatchObject({
      transitionId: 'build.work-execution-migration-required',
    });
  });

  it('routes Build Check and Verify implementation findings through ordinary Plan revision', () => {
    const tasks = parseSpecificationTasks(
      'managed-rework',
      '- [ ] 1.1 Implement the managed behavior.\n  **Acceptance:** Managed behavior passes.\n',
    );
    const completedTasks = tasks.tasks.map((task) => ({ ...task, status: 'completed' as const }));
    const intent = createExecutionWorkspaceIntent({
      workspaceId: initialSnapshot().identity.workspaceId,
      changeId: initialSnapshot().identity.changeId,
      isolation: 'current',
    });
    const binding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: 'C:\\workspace',
          branch: 'main',
          head: '1'.repeat(40),
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });
    const strategy = createBuildStrategy({
      runId: initialSnapshot().identity.runId,
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'direct',
      reviewMode: 'standard',
      isolationIntent: intent.isolation,
    });
    const executionBinding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'managed-host',
      workspaceBinding: binding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:test',
    });
    const plan = createBuildPlan({
      runId: initialSnapshot().identity.runId,
      revision: 1,
      strategy,
      binding: executionBinding,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'implementation',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map(
              (criterion) => criterion.acceptanceId,
            ),
            expectedOutcomes: ['managed-behavior-passes'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
            sideEffectClass: 'repository-write',
            completionContract: {
              schemaVersion: 1,
              behaviorSlice: 'managed-behavior',
              requiredEvidence: ['acceptance', 'implementation', 'test', 'regression'],
            },
          },
        ],
      },
    });
    const planEvidence = createPlanEvidence({
      plan,
      strategy,
      binding: executionBinding,
      validation: validateBuildPlan({
        plan,
        strategy,
        binding: executionBinding,
        tasks,
        protectedBranches: [],
      }),
      protectedBranches: [],
      compositionCheckpointDigest: digest('c'),
      reportOwnerId: 'team-platform',
    });
    let protocol = createBuildProtocolState({
      runId: initialSnapshot().identity.runId,
      planningDigest: tasks.digest,
      strategy,
    });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'binding-accepted',
      binding: executionBinding,
    });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'plan-accepted',
      plan,
      workspaceCheckpoint: nextWorkspaceCheckpoint(protocol),
    });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'plan-evidence-accepted',
      evidence: planEvidence,
    });
    const workspaceCheckpoint = advanceBuildWorkspaceCheckpoint({
      current: protocol.workspaceCheckpoint!,
      observed: protocol.workspaceCheckpoint!.repositories,
      writableRepositoryIds: ['workspace'],
      relations: { workspace: 'unchanged' },
    });
    const completion = createPackageCompletionEvidence({
      workPackage: plan.packages[0]!,
      executionId: 'implementation-execution',
      acceptanceEvidenceIds: ['acceptance-1'],
      testEvidenceIds: ['test-1'],
      tddMode: 'direct',
      workspaceCheckpointDigest: workspaceCheckpoint.digest,
      implementationDigest: digest('a'),
    });
    protocol = advanceBuildProtocol(protocol, {
      kind: 'package-completed',
      completion,
      workspaceCheckpoint,
    });

    const finding = {
      findingId: 'finding-1',
      classification: 'implementation' as const,
      blocking: true,
      requirementRefs: [],
      taskIds: ['1.1'],
      packageIds: [plan.packages[0]!.packageId],
      summary: 'Implementation behavior failed the managed check.',
    };
    const rejectedCheck = createBuildCheckEvidence({
      strategyDigest: strategy.semanticDigest,
      bindingStateDigest: executionBinding.stateDigest,
      planDigest: plan.digest,
      workspaceCheckpointDigest: protocol.workspaceCheckpoint!.digest,
      implementationDigest: digest('b'),
      completedPackageIds: [plan.packages[0]!.packageId],
      acceptedTaskIds: ['1.1'],
      testEvidenceIds: ['build-check-test'],
      review: {
        mode: 'standard',
        implementationExecutionId: completion.executionId,
        reviewerExecutionId: 'independent-reviewer',
      },
      findings: [finding],
    });
    const checkInvalidation = createBuildInvalidation({
      source: 'build-check',
      plan,
      classification: 'implementation',
      affectedPackageIds: [plan.packages[0]!.packageId],
      packageCompletions: protocol.packageCompletions,
      reason: finding.summary,
    });
    const checkWork = phaseWork('build', 'build.check', 10, rejectedCheck.digest);
    const planWork = phaseWork('build', 'build.plan', 11, checkInvalidation.digest);
    const afterCheck = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 10,
        checkEpoch: 10,
        phase: 'build',
        currentWork: checkWork,
        tasks: completedTasks,
        planningDigest: tasks.digest,
        workspaceIntent: intent,
        buildProtocol: protocol,
      }),
      observation: {
        kind: 'build-check-rejected',
        evidence: rejectedCheck,
        invalidation: checkInvalidation,
        work: planWork,
      },
    });
    expect(afterCheck.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      checkEpoch: 11,
      currentWork: { kind: 'build.plan' },
      tasks: [{ taskId: '1.1', status: 'completed' }],
      buildProtocol: { currentAction: 'plan', status: 'active' },
    });
    expect(afterCheck.snapshot.identity.runId).toBe(initialSnapshot().identity.runId);

    const acceptedCheck = createBuildCheckEvidence({
      ...rejectedCheck,
      findings: [],
      review: rejectedCheck.review,
    });
    const readyProtocol = advanceBuildProtocol(protocol, {
      kind: 'check-accepted',
      evidence: acceptedCheck,
    });
    const verifyInput = {
      ...verificationInput(12, 'c'),
      taskRevisions: completedTasks.map(({ taskId, taskRevision }) => ({ taskId, taskRevision })),
    };
    const verifyWork = phaseWork('verify', 'evidence.verify', 12, verifyInput.digest);
    const verifyInvalidation = createBuildInvalidation({
      source: 'verify',
      plan,
      classification: 'implementation',
      affectedPackageIds: [plan.packages[0]!.packageId],
      packageCompletions: readyProtocol.packageCompletions,
      reason: 'Verify found an implementation regression.',
    });
    const afterVerify = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 12,
        checkEpoch: 12,
        phase: 'verify',
        currentWork: verifyWork,
        tasks: completedTasks,
        planningDigest: tasks.digest,
        workspaceIntent: intent,
        buildProtocol: readyProtocol,
        verificationInput: verifyInput,
      }),
      observation: {
        kind: 'verify-gate-rejected',
        workId: verifyWork.workId,
        inputDigest: verifyInput.digest,
        evidenceInputFingerprint: verifyInput.evidenceProfile.fingerprintDigest,
        attemptId: 'verify-attempt-1',
        bundleId: 'failed-bundle-1',
        reason: 'Verify found an implementation regression.',
        result: 'implementation-failure',
        checkEpoch: 12,
        tasks: completedTasks,
        invalidation: verifyInvalidation,
        work: phaseWork('build', 'build.plan', 13, verifyInvalidation.digest),
      },
    });
    expect(afterVerify.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      checkEpoch: 13,
      currentWork: { kind: 'build.plan' },
      tasks: [{ taskId: '1.1', status: 'completed' }],
      buildProtocol: { currentAction: 'plan', status: 'active' },
      verificationInvalidation: { kind: 'implementation-drift' },
    });
    expect(afterVerify.snapshot.identity.runId).toBe(initialSnapshot().identity.runId);

    const revisedPlan = createBuildPlan({
      runId: initialSnapshot().identity.runId,
      revision: 2,
      strategy,
      binding: executionBinding,
      planningDigest: tasks.digest,
      tasks,
      candidate: {
        packages: [
          {
            packageKey: 'implementation',
            taskIds: ['1.1'],
            repositoryIds: ['workspace'],
            writeScopes: [{ repositoryId: 'workspace', paths: ['src/**'] }],
            acceptanceRefs: tasks.tasks[0]!.acceptanceCriteria.map(
              (criterion) => criterion.acceptanceId,
            ),
            expectedOutcomes: ['managed-behavior-passes'],
            validatorProfile: 'build.package-valid',
            dependsOn: [],
            sideEffectClass: 'repository-write',
            completionContract: {
              schemaVersion: 1,
              behaviorSlice: 'managed-behavior',
              requiredEvidence: ['acceptance', 'implementation', 'test', 'regression'],
            },
          },
        ],
      },
    });
    const afterReplan = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: afterVerify.snapshot,
      observation: {
        kind: 'build-plan-accepted',
        plan: revisedPlan,
        workspaceCheckpoint: nextWorkspaceCheckpoint(afterVerify.snapshot.buildProtocol!),
      },
    });
    expect(afterReplan.snapshot).toMatchObject({
      phase: 'build',
      currentWork: null,
      buildProtocol: {
        currentAction: 'plan-evidence',
        plan: { revision: 2 },
        invalidations: [{ source: 'verify' }],
      },
    });
    expect(afterReplan.snapshot.verificationInput).toBeUndefined();
    expect(afterReplan.snapshot.verificationInvalidation).toBeUndefined();
  });

  it('keeps execution status orthogonal to every active phase', () => {
    const activeStatuses: RunStatus[] = [
      'running',
      'waiting',
      'blocked',
      'failed',
      'migration_required',
    ];

    for (const phase of CHANGE_PHASES) {
      for (const status of activeStatuses) {
        const snapshot = initialSnapshot({
          phase,
          status,
          waitCondition: status === 'waiting' ? approvalWait() : null,
          blocker: ['blocked', 'failed', 'migration_required'].includes(status)
            ? blocker(status)
            : null,
        });
        expect(() => assertChangeLifecycleSnapshot(snapshot)).not.toThrow();
      }
    }
    expect(() =>
      assertChangeLifecycleSnapshot(
        initialSnapshot({ phase: 'verify', status: 'completed', revision: 9 }),
      ),
    ).toThrow('must finish in Archive');
  });

  it('returns identical transition facts and query projections for identical inputs', () => {
    const input = {
      definition,
      current: initialSnapshot(),
      transitionId: 'open.ready',
      next: cleared,
    } as const;

    const first = applyChangeLifecycleTransition(input);
    const repeated = applyChangeLifecycleTransition(input);
    expect(repeated).toEqual(first);
    const projectionDetails = {
      taskProgress: { total: 4, completed: 0, currentTaskId: null },
      evidence: {
        gateStatus: 'not-evaluated' as const,
        acceptedBundleIds: [],
        latestAttemptId: null,
      },
      nextActions: [{ id: 'design.next', kind: 'work' as const, label: 'Continue Design' }],
      freshness: {
        stateVersion: 1,
        trajectoryOffset: 2,
        observedAt: '2026-10-24T00:00:00.000Z',
      },
    };
    expect(projectChangeRun(first.snapshot, projectionDetails)).toEqual(
      projectChangeRun(repeated.snapshot, projectionDetails),
    );
  });
});
