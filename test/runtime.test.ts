import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { projectReconciliationDigest } from '../domains/runtime/authorized-rebind.js';
import { reconcileProjectSnapshots } from '../domains/project/snapshot.js';
import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import {
  createBuildStrategy,
  createExecutionBinding,
  createBuildProtocolState,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import { createBuildActionWork } from '../domains/change-lifecycle/build-work.js';
import { createLifecyclePhaseWork } from '../domains/change-lifecycle/phase-work.js';
import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';
import { classifyRecoveryObservation } from '../domains/runtime/recovery.js';
import type { WorkExecutionCheckpoint } from '../domains/work-execution/types.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';
import {
  lifecycleContributorIdentity,
  lifecycleContributorSnapshot,
} from '../domains/change-lifecycle/contributors.js';
import type { EvidenceGatePort, TelemetryBatch, TelemetryPort } from '../domains/runtime/types.js';
import { createWorkflowPackage } from '../domains/workflow-contract/package.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const strategyFor = (runId: string, intent: ReturnType<typeof createExecutionWorkspaceIntent>) =>
  createBuildStrategy({
    runId,
    revision: 1,
    executionMode: 'autonomous',
    tddMode: 'tdd',
    reviewMode: 'standard',
    isolationIntent: intent.isolation,
  });

class FlakyTelemetry implements TelemetryPort {
  attempts = 0;
  batches: TelemetryBatch[] = [];

  export(batch: TelemetryBatch): Promise<void> {
    this.attempts += 1;
    if (this.attempts === 1) return Promise.reject(new Error('collector unavailable'));
    this.batches.push(structuredClone(batch));
    return Promise.resolve();
  }
}

describe('Repoctopus runtime', () => {
  function evidenceWorkflow() {
    const definition = structuredClone(workflowFixture().definition);
    definition.steps[1]!.action.evidenceProfile = 'verify';
    return createWorkflowPackage(definition);
  }

  it('blocks unresolved execution replacement and retires it only after a known outcome', async () => {
    const workspace = await temporaryDirectory('repoctopus-open-repair-runtime-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    const runId = 'change-team-open-repair';
    const actionSkill = {
      schemaVersion: 1 as const,
      name: 'repoctopus-open-change',
      provider: 'repoctopus-builtins',
      invocation: { modelInvocable: true, userInvocable: false },
      contentDigest: `sha256:${'1'.repeat(64)}` as const,
      resourceManifestDigest: `sha256:${'2'.repeat(64)}` as const,
    };
    const augmentationSkill = {
      schemaVersion: 1 as const,
      name: 'grilling',
      provider: 'matt-builtins',
      invocation: { modelInvocable: true, userInvocable: true },
      contentDigest: `sha256:${'8'.repeat(64)}` as const,
      resourceManifestDigest: `sha256:${'9'.repeat(64)}` as const,
    };
    const createOpenWork = (checkEpoch: number) =>
      createLifecyclePhaseWork({
        runId,
        checkEpoch,
        changeId: 'open-repair',
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'change.intake',
        actionSkill,
        augmentationSkills: [augmentationSkill],
        compositionDigest: compositionFixture().compositionDigest,
        projectSnapshotDigest: projectFixture({ projectId: 'team' }).digest,
        projectConfigDigest: `sha256:${'3'.repeat(64)}`,
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace'],
      });
    const originalWork = createOpenWork(0);
    const repairWork = createOpenWork(1);
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({ projectId: 'team' }),
      runId,
      changeLifecycle: {
        ...createChangeLifecycleSnapshot({
          identity: { workspaceId: 'team', changeId: 'open-repair', runId },
        }),
        currentWork: originalWork,
      },
    });
    const checkpoint: WorkExecutionCheckpoint = {
      schemaVersion: 3,
      workId: originalWork.workId,
      attempt: 1,
      checkEpoch: 0,
      intentId: 'intent-open-repair',
      claimToken: `sha256:${'4'.repeat(64)}`,
      inputDigest: originalWork.inputDigest,
      packet: {
        schemaVersion: 1,
        packetId: `sha256:${'5'.repeat(64)}`,
        packetDigest: `sha256:${'6'.repeat(64)}`,
        contextDigest: `sha256:${'7'.repeat(64)}`,
      },
      status: 'invoking',
      continuation: 'wait',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    await store.commitGuarded(runId, ({ state, trajectory }) => ({
      state: {
        ...state,
        workExecution: checkpoint,
        stateVersion: state.stateVersion + 1,
        updatedAt: checkpoint.updatedAt,
      },
      event: {
        schemaVersion: 1,
        sequence: trajectory.length + 1,
        eventId: 'seed-open-outcome',
        timestamp: checkpoint.updatedAt,
        type: 'work.completed',
        runId,
        stateVersion: state.stateVersion + 1,
        compositionDigest: state.composition.compositionDigest,
        data: { workId: originalWork.workId },
      },
      value: undefined,
    }));

    const repairObservation = {
      kind: 'open-repair-required',
      expectedRevision: 0,
      source: 'strict-validation',
      reasonCode: 'strict-validation-invalid',
      evidenceIds: [`sha256:${'8'.repeat(64)}`],
      inputDigest: repairWork.inputDigest,
      work: repairWork,
    } as const;

    await expect(runtime.acceptChangeObservation(runId, repairObservation)).rejects.toThrow(
      /cannot replace an unresolved Work execution/u,
    );
    expect(await store.loadRun(runId)).toMatchObject({
      workExecution: { status: 'invoking', workId: originalWork.workId },
      changeLifecycle: { checkEpoch: 0, currentWork: { workId: originalWork.workId } },
    });
    await store.commitGuarded(runId, ({ state, trajectory }) => {
      const nextState = {
        ...state,
        workExecution: { ...state.workExecution!, status: 'outcome' as const },
        stateVersion: state.stateVersion + 1,
        updatedAt: '2026-11-01T00:01:00.000Z',
      };
      return {
        state: nextState,
        event: {
          schemaVersion: 1,
          sequence: trajectory.length + 1,
          eventId: 'seed-open-known-outcome',
          timestamp: nextState.updatedAt,
          type: 'work.completed',
          runId,
          stateVersion: nextState.stateVersion,
          compositionDigest: nextState.composition.compositionDigest,
          data: { workId: originalWork.workId, result: 'known' },
        },
        value: undefined,
      };
    });

    const accepted = await runtime.acceptChangeObservation(runId, repairObservation);

    expect(accepted.value.state).not.toHaveProperty('workExecution');
    expect(accepted.value.state.changeLifecycle?.openApprovalInvalidated).toBe(true);
    expect(accepted.value.changeLifecycle).toMatchObject({
      phase: 'open',
      status: 'running',
      checkEpoch: 1,
      currentWork: { workId: repairWork.workId },
      nextActions: [{ id: repairWork.workId, kind: 'work' }],
    });
    expect((await store.loadTrajectory(runId)).at(-1)?.data).toMatchObject({
      observationKind: 'open-repair-required',
      changeLifecycleTransition: {
        openRepair: {
          source: 'strict-validation',
          previousCheckEpoch: 0,
          nextCheckEpoch: 1,
        },
      },
      executionRetirement: {
        reason: 'lifecycle-work-changed',
        retiredWorkId: originalWork.workId,
        nextWorkId: repairWork.workId,
      },
    });
  });

  it('commits planning invalidation, suspended Build state, and execution retirement exactly once', async () => {
    const workspace = await temporaryDirectory('repoctopus-planning-invalidation-runtime-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    const runId = 'change-team-planning-invalidation';
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'planning-invalidation',
      isolation: 'current',
    });
    const tasks = parseSpecificationTasks(
      'planning-invalidation',
      '- [ ] 1.1 Preserve the accepted Task.\n  **Acceptance:** The Task remains inspectable during Design repair.\n',
    );
    const configureWork = createBuildActionWork({
      runId,
      checkEpoch: 4,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.configure',
      actionSkill: {
        schemaVersion: 1,
        name: 'repoctopus-build-configure',
        provider: 'repoctopus-builtins',
        invocation: { modelInvocable: true, userInvocable: false },
        contentDigest: `sha256:${'2'.repeat(64)}`,
        resourceManifestDigest: `sha256:${'3'.repeat(64)}`,
      },
      augmentationSkills: [],
      compositionDigest: compositionFixture().compositionDigest,
      projectConfigDigest: `sha256:${'4'.repeat(64)}`,
      projectSnapshotDigest: projectFixture({ projectId: 'team' }).digest,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
      stableInput: { planningDigest: tasks.digest },
    });
    const designWork = createLifecyclePhaseWork({
      runId,
      checkEpoch: 5,
      changeId: 'planning-invalidation',
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'specification.plan',
      actionSkill: {
        schemaVersion: 1,
        name: 'repoctopus-design-change',
        provider: 'repoctopus-builtins',
        invocation: { modelInvocable: true, userInvocable: false },
        contentDigest: `sha256:${'5'.repeat(64)}`,
        resourceManifestDigest: `sha256:${'6'.repeat(64)}`,
      },
      augmentationSkills: [
        {
          schemaVersion: 1,
          name: 'codebase-design',
          provider: 'matt-builtins',
          invocation: { modelInvocable: true, userInvocable: true },
          contentDigest: `sha256:${'d'.repeat(64)}`,
          resourceManifestDigest: `sha256:${'e'.repeat(64)}`,
        },
      ],
      compositionDigest: compositionFixture().compositionDigest,
      projectSnapshotDigest: projectFixture({ projectId: 'team' }).digest,
      projectConfigDigest: `sha256:${'4'.repeat(64)}`,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
    });
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({ projectId: 'team' }),
      runId,
      changeLifecycle: {
        ...createChangeLifecycleSnapshot({
          identity: { workspaceId: 'team', changeId: 'planning-invalidation', runId },
        }),
        revision: 4,
        checkEpoch: 4,
        phase: 'build',
        currentWork: configureWork,
        tasks: tasks.tasks,
        workspaceIntent: intent,
        planningDigest: tasks.digest,
        buildProtocol: createBuildProtocolState({
          runId,
          planningDigest: tasks.digest,
          strategy: strategyFor(runId, intent),
        }),
      },
    });
    const checkpoint: WorkExecutionCheckpoint = {
      schemaVersion: 3,
      workId: configureWork.workId,
      attempt: 1,
      checkEpoch: 4,
      intentId: 'intent-planning-invalidation',
      claimToken: `sha256:${'7'.repeat(64)}`,
      inputDigest: configureWork.inputDigest,
      packet: {
        schemaVersion: 1,
        packetId: `sha256:${'8'.repeat(64)}`,
        packetDigest: `sha256:${'9'.repeat(64)}`,
        contextDigest: `sha256:${'a'.repeat(64)}`,
      },
      status: 'outcome',
      continuation: 'execute',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    await store.commitGuarded(runId, ({ state, trajectory }) => ({
      state: {
        ...state,
        workExecution: checkpoint,
        stateVersion: state.stateVersion + 1,
        updatedAt: checkpoint.updatedAt,
      },
      event: {
        schemaVersion: 1,
        sequence: trajectory.length + 1,
        eventId: 'seed-planning-invalidation-outcome',
        timestamp: checkpoint.updatedAt,
        type: 'work.completed',
        runId,
        stateVersion: state.stateVersion + 1,
        compositionDigest: state.composition.compositionDigest,
        data: { workId: configureWork.workId },
      },
      value: undefined,
    }));
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId,
      expectedRevision: 4,
      checkEpoch: 4,
      observationId: 'planning-observation-runtime-1',
      planning: {
        status: 'drift',
        reasonCode: 'design-changed',
        changedIdentities: ['planning-semantic'],
      },
      plan: { status: 'current', changedIdentities: [] },
      work: { status: 'current', changedIdentities: [] },
      evidence: { status: 'current', changedIdentities: [] },
    });
    if (!decision) throw new Error('expected recovery decision');
    const materialization = {
      evidenceIds: [`sha256:${'b'.repeat(64)}`],
      inputDigest: `sha256:${'c'.repeat(64)}` as const,
      work: designWork,
    };

    await Promise.all([
      runtime.acceptRecoveryDecision(runId, decision, materialization),
      runtime.acceptRecoveryDecision(runId, decision, materialization),
    ]);
    const trajectory = await store.loadTrajectory(runId);
    const state = await store.loadRun(runId);
    expect(state).not.toHaveProperty('workExecution');
    expect(state.changeLifecycle).toMatchObject({
      phase: 'design',
      checkEpoch: 5,
      currentWork: { workId: designWork.workId },
      tasks: [{ taskId: tasks.tasks[0]!.taskId }],
      buildProtocol: { status: 'suspended-for-design', currentAction: null },
    });
    expect(
      trajectory.find(
        (entry) =>
          entry.type === 'change.lifecycle.transitioned' &&
          entry.data.observationKind === 'runtime-recovery-decision',
      )?.data,
    ).toMatchObject({
      observationKind: 'runtime-recovery-decision',
      recoveryDecision: {
        decisionId: decision.decisionId,
        action: 'revise-design',
        authority: 'planning',
      },
      changeLifecycleTransition: {
        invalidation: { classification: 'semantic', scope: 'exact' },
        recovery: { decisionId: decision.decisionId, action: 'revise-design' },
      },
      executionRetirement: {
        retiredWorkId: configureWork.workId,
        nextWorkId: designWork.workId,
      },
    });
    expect(
      trajectory.filter((entry) => entry.type.startsWith('recovery.')).map((entry) => entry.type),
    ).toEqual(['recovery.observed', 'recovery.classified', 'recovery.applied']);
    expect(new Set(trajectory.slice(-3).map((entry) => entry.data.decisionId))).toEqual(
      new Set([decision.decisionId]),
    );
    expect(await store.loadTrajectory(runId)).toHaveLength(trajectory.length);
  });

  it('retires a mismatched execution checkpoint atomically with workspace intent revision', async () => {
    const workspace = await temporaryDirectory('repoctopus-intent-revision-runtime-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    const runId = 'change-team-revise-intent';
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'revise-intent',
      isolation: 'current',
    });
    const planningDigest = `sha256:${'1'.repeat(64)}` as const;
    const configureWork = createBuildActionWork({
      runId,
      checkEpoch: 4,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.configure',
      actionSkill: {
        schemaVersion: 1,
        name: 'repoctopus-build-configure',
        provider: 'repoctopus-builtins',
        invocation: { modelInvocable: true, userInvocable: false },
        contentDigest: `sha256:${'2'.repeat(64)}`,
        resourceManifestDigest: `sha256:${'3'.repeat(64)}`,
      },
      augmentationSkills: [],
      compositionDigest: compositionFixture().compositionDigest,
      projectConfigDigest: `sha256:${'4'.repeat(64)}`,
      projectSnapshotDigest: projectFixture({ projectId: 'team' }).digest,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
      stableInput: { planningDigest },
    });
    const lifecycle = {
      ...createChangeLifecycleSnapshot({
        identity: { workspaceId: 'team', changeId: 'revise-intent', runId },
      }),
      revision: 4,
      checkEpoch: 4,
      phase: 'build' as const,
      status: 'running' as const,
      currentWork: configureWork,
      workspaceIntent: intent,
      planningDigest,
      buildProtocol: createBuildProtocolState({
        runId,
        planningDigest,
        strategy: strategyFor(runId, intent),
      }),
    };
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({
        projectId: 'team',
        repositories: [
          {
            id: 'workspace',
            name: 'workspace',
            path: 'C:/workspace',
            remoteIdentity: null,
            branch: 'main',
            head: '1'.repeat(40),
            worktree: {
              dirty: false,
              digest: 'clean',
              staged: 0,
              unstaged: 0,
              untracked: 0,
            },
          },
        ],
      }),
      runId,
      changeLifecycle: lifecycle,
    });
    const checkpoint: WorkExecutionCheckpoint = {
      schemaVersion: 3,
      workId: configureWork.workId,
      attempt: 1,
      checkEpoch: 4,
      intentId: 'intent-1',
      claimToken: `sha256:${'5'.repeat(64)}`,
      inputDigest: configureWork.inputDigest,
      packet: {
        schemaVersion: 1,
        packetId: `sha256:${'6'.repeat(64)}`,
        packetDigest: `sha256:${'7'.repeat(64)}`,
        contextDigest: `sha256:${'8'.repeat(64)}`,
      },
      status: 'outcome',
      continuation: 'execute',
      updatedAt: '2026-10-30T00:00:00.000Z',
    };
    await store.commitGuarded(runId, ({ state, trajectory }) => {
      const nextState = {
        ...state,
        workExecution: checkpoint,
        stateVersion: state.stateVersion + 1,
        updatedAt: '2026-10-30T00:00:00.000Z',
      };
      return {
        state: nextState,
        event: {
          schemaVersion: 1,
          sequence: trajectory.length + 1,
          eventId: 'seed-build-configure-outcome',
          timestamp: nextState.updatedAt,
          type: 'work.completed',
          runId,
          stateVersion: nextState.stateVersion,
          compositionDigest: nextState.composition.compositionDigest,
          data: { workId: configureWork.workId },
        },
        value: undefined,
      };
    });

    const observation = {
      kind: 'workspace-intent-revision-required' as const,
      requestId: 'workspace-intent-revision-1',
      proposalDigest: `sha256:${'9'.repeat(64)}` as const,
      reason: 'Current isolation cannot bind a linked worktree.',
      evidenceIds: ['execution-workspace-binding:current-linked-worktree'],
      errorCode: 'current-linked-worktree',
      previousIsolation: 'current' as const,
    };
    await runtime.acceptChangeObservation(runId, observation);
    const retired = await store.loadRun(runId);
    expect(retired).not.toHaveProperty('workExecution');
    expect(retired).toMatchObject({
      status: 'waiting',
      changeLifecycle: { phase: 'open', checkEpoch: 5, currentWork: null },
    });
    const trajectory = await store.loadTrajectory(runId);
    expect(trajectory.map((entry) => entry.type)).toContain('work.completed');
    expect(trajectory.at(-1)?.data).toMatchObject({
      observationKind: 'workspace-intent-revision-required',
      executionRetirement: {
        reason: 'workspace-intent-revision',
        retiredWorkId: configureWork.workId,
        retiredCheckEpoch: 4,
        nextWorkId: null,
        nextCheckEpoch: 5,
      },
    });

    await runtime.acceptChangeObservation(runId, observation);
    expect(await store.loadTrajectory(runId)).toHaveLength(trajectory.length);
  });

  it('retires Configure execution when an accepted Binding installs Plan Work', async () => {
    const workspace = await temporaryDirectory('repoctopus-lifecycle-execution-runtime-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    const runId = 'change-team-configure-wait';
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'configure-wait',
      isolation: 'current',
    });
    const planningDigest = `sha256:${'1'.repeat(64)}` as const;
    const configureWork = createBuildActionWork({
      runId,
      checkEpoch: 4,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.configure',
      actionSkill: {
        schemaVersion: 1,
        name: 'repoctopus-build-configure',
        provider: 'repoctopus-builtins',
        invocation: { modelInvocable: true, userInvocable: false },
        contentDigest: `sha256:${'2'.repeat(64)}`,
        resourceManifestDigest: `sha256:${'3'.repeat(64)}`,
      },
      augmentationSkills: [],
      compositionDigest: compositionFixture().compositionDigest,
      projectConfigDigest: `sha256:${'4'.repeat(64)}`,
      projectSnapshotDigest: projectFixture({ projectId: 'team' }).digest,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
      stableInput: { planningDigest },
    });
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({ projectId: 'team' }),
      runId,
      changeLifecycle: {
        ...createChangeLifecycleSnapshot({
          identity: { workspaceId: 'team', changeId: 'configure-wait', runId },
        }),
        revision: 4,
        checkEpoch: 4,
        phase: 'build',
        status: 'running',
        currentWork: configureWork,
        workspaceIntent: intent,
        planningDigest,
        buildProtocol: createBuildProtocolState({
          runId,
          planningDigest,
          strategy: strategyFor(runId, intent),
        }),
      },
    });
    const checkpoint: WorkExecutionCheckpoint = {
      schemaVersion: 3,
      workId: configureWork.workId,
      attempt: 1,
      checkEpoch: 4,
      intentId: 'intent-configure-wait',
      claimToken: `sha256:${'5'.repeat(64)}`,
      inputDigest: configureWork.inputDigest,
      packet: {
        schemaVersion: 1,
        packetId: `sha256:${'6'.repeat(64)}`,
        packetDigest: `sha256:${'7'.repeat(64)}`,
        contextDigest: `sha256:${'8'.repeat(64)}`,
      },
      status: 'validated',
      continuation: 'execute',
      updatedAt: '2026-10-30T00:00:00.000Z',
    };
    await store.commitGuarded(runId, ({ state, trajectory }) => {
      const nextState = {
        ...state,
        workExecution: checkpoint,
        stateVersion: state.stateVersion + 1,
        updatedAt: checkpoint.updatedAt,
      };
      return {
        state: nextState,
        event: {
          schemaVersion: 1,
          sequence: trajectory.length + 1,
          eventId: 'seed-validated-build-configure',
          timestamp: checkpoint.updatedAt,
          type: 'validator.completed',
          runId,
          stateVersion: nextState.stateVersion,
          compositionDigest: nextState.composition.compositionDigest,
          data: { workId: configureWork.workId },
        },
        value: undefined,
      };
    });
    const binding = createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: 'C:/workspace',
          branch: 'main',
          head: '1'.repeat(40),
          worktreeId: null,
          workspaceOwned: true,
        },
      ],
    });
    const strategy = strategyFor(runId, intent);
    const executionBinding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'external:cli:test',
      workspaceBinding: binding,
      workspaceOwnerId: intent.workspaceId,
      localOverlayRef: 'execution-workspace:test',
    });
    const planWork = createBuildActionWork({
      runId,
      checkEpoch: 5,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.plan',
      actionSkill: {
        ...configureWork.actionSkill!,
        name: 'repoctopus-build-plan',
      },
      augmentationSkills: [],
      compositionDigest: compositionFixture().compositionDigest,
      projectConfigDigest: `sha256:${'4'.repeat(64)}`,
      projectSnapshotDigest: projectFixture({ projectId: 'team' }).digest,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
      strategyId: strategy.strategyId,
      bindingId: executionBinding.bindingId,
      executionMode: strategy.executionMode,
      tddMode: strategy.tddMode,
      stableInput: { bindingStateDigest: executionBinding.stateDigest },
    });

    await runtime.acceptChangeObservation(runId, {
      kind: 'build-binding-accepted',
      binding: executionBinding,
      work: planWork,
    });

    const advanced = await store.loadRun(runId);
    expect(advanced).not.toHaveProperty('workExecution');
    expect(advanced).toMatchObject({
      status: 'running',
      changeLifecycle: {
        phase: 'build',
        checkEpoch: 5,
        currentWork: { kind: 'build.plan', workId: planWork.workId },
        waitCondition: null,
      },
    });
    expect((await store.loadTrajectory(runId)).at(-1)?.data).toMatchObject({
      observationKind: 'build-binding-accepted',
      executionRetirement: {
        reason: 'lifecycle-work-changed',
        retiredWorkId: configureWork.workId,
        retiredCheckEpoch: 4,
        nextWorkId: planWork.workId,
        nextCheckEpoch: 5,
      },
    });
  });

  it('binds the first Skill use to Run, Checkpoint, and Trajectory idempotently', async () => {
    const workspace = await temporaryDirectory('repoctopus-skill-binding-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-skill-binding',
    });
    const snapshot = {
      schemaVersion: 1 as const,
      name: 'tdd',
      provider: 'matt-builtins',
      invocation: { modelInvocable: true, userInvocable: true },
      contentDigest: `sha256:${'a'.repeat(64)}` as const,
      resourceManifestDigest: `sha256:${'b'.repeat(64)}` as const,
    };
    await runtime.bindSkill('run-skill-binding', snapshot);
    await runtime.bindSkill('run-skill-binding', snapshot);
    expect((await store.loadRun('run-skill-binding')).skillUsageSnapshots).toEqual([snapshot]);
    expect((await store.loadCheckpoint('run-skill-binding')).skillUsageSnapshots).toEqual([
      snapshot,
    ]);
    const trajectory = await store.loadTrajectory('run-skill-binding');
    expect(trajectory.map((item) => item.type)).toEqual(['run.started', 'skill.bound']);
    expect(JSON.stringify(trajectory)).not.toContain('SKILL.md');
    expect(JSON.stringify(trajectory)).not.toContain('.repoctopus/learning');
    await expect(
      runtime.bindSkill('run-skill-binding', {
        ...snapshot,
        contentDigest: `sha256:${'c'.repeat(64)}`,
      }),
    ).rejects.toThrow('Skill drift detected');
  });

  it('binds one Specification authority and rejects a changed validation snapshot', async () => {
    const workspace = await temporaryDirectory('repoctopus-specification-binding-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-specification-binding',
    });
    const snapshot = {
      schemaVersion: 1 as const,
      changeId: 'change-one',
      provider: {
        id: 'openspec',
        version: '1.14.3',
        protocolVersion: 'repoctopus.specification/v1alpha1' as const,
      },
      validationDigest: `sha256:${'d'.repeat(64)}` as const,
    };
    await runtime.bindSpecification('run-specification-binding', snapshot);
    await runtime.bindSpecification('run-specification-binding', snapshot);
    const closure = {
      changeId: snapshot.changeId,
      provider: snapshot.provider,
      planDigest: `sha256:${'f'.repeat(64)}` as const,
    };
    await runtime.bindSpecificationClosurePlan('run-specification-binding', closure);
    await runtime.bindSpecificationClosurePlan('run-specification-binding', closure);
    expect((await store.loadRun('run-specification-binding')).specificationUsageSnapshot).toEqual({
      ...snapshot,
      closurePlanDigest: closure.planDigest,
    });
    expect(
      (await store.loadCheckpoint('run-specification-binding')).specificationUsageSnapshot,
    ).toEqual({ ...snapshot, closurePlanDigest: closure.planDigest });
    expect(
      (await store.loadTrajectory('run-specification-binding')).map((event) => event.type),
    ).toEqual(['run.started', 'specification.bound', 'specification.closure-planned']);
    await expect(
      runtime.bindSpecification('run-specification-binding', {
        ...snapshot,
        validationDigest: `sha256:${'e'.repeat(64)}`,
      }),
    ).rejects.toThrow('Specification drift detected');
  });

  it('records compatible composition changes and blocks incompatible writes while keeping reads', async () => {
    const workspace = await temporaryDirectory('repoctopus-composition-drift-');
    cleanup.push(workspace);
    const telemetryBefore = compositionFixture({
      compositionDigest: `sha256:${'1'.repeat(64)}`,
      plugins: [
        {
          id: 'telemetry',
          version: '1.0.0',
          configDigest: `sha256:${'a'.repeat(64)}`,
          codeDigest: `sha256:${'a'.repeat(64)}`,
          descriptorDigest: `sha256:${'a'.repeat(64)}`,
          authorities: [],
          stateSchemas: {},
        },
      ],
    });
    const telemetryAfter = structuredClone(telemetryBefore);
    telemetryAfter.compositionDigest = `sha256:${'2'.repeat(64)}`;
    telemetryAfter.plugins[0]!.codeDigest = `sha256:${'b'.repeat(64)}`;
    telemetryAfter.plugins[0]!.descriptorDigest = `sha256:${'b'.repeat(64)}`;

    const initial = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      telemetryBefore,
    );
    await initial.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-composition-drift',
    });
    const compatible = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      telemetryAfter,
    );
    const proposed = await compatible.next('run-composition-drift');
    expect(proposed.value.state.composition.compositionDigest).toBe(
      telemetryAfter.compositionDigest,
    );
    expect(
      (await new FileRuntimeStore(workspace).loadTrajectory('run-composition-drift')).map(
        (item) => item.type,
      ),
    ).toEqual(['run.started', 'composition.changed', 'action.proposed']);

    const incompatibleComposition = compositionFixture({
      compositionDigest: `sha256:${'3'.repeat(64)}`,
      plugins: [
        {
          id: 'workflow-runs',
          version: '2.0.0',
          configDigest: `sha256:${'a'.repeat(64)}`,
          codeDigest: `sha256:${'c'.repeat(64)}`,
          descriptorDigest: `sha256:${'c'.repeat(64)}`,
          authorities: ['workflow-transition'],
          stateSchemas: { run: '2' },
        },
      ],
    });
    const incompatible = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      incompatibleComposition,
    );
    expect(
      (await incompatible.status('run-composition-drift')).compositionCompatibility.status,
    ).toBe('migration_required');
    const beforeRejectedWrite = await new FileRuntimeStore(workspace).loadTrajectory(
      'run-composition-drift',
    );
    await expect(incompatible.next('run-composition-drift')).rejects.toThrow(/migration_required/i);
    expect(
      (await incompatible.status('run-composition-drift')).compositionCompatibility.status,
    ).toBe('migration_required');
    expect(await new FileRuntimeStore(workspace).loadTrajectory('run-composition-drift')).toEqual(
      beforeRejectedWrite,
    );
  });

  it('adopts compatible composition but refuses a pre-cutover lifecycle definition', async () => {
    const workspace = await temporaryDirectory('repoctopus-definition-recovery-order-');
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const predecessor = {
      codeDigest: `sha256:${'1'.repeat(64)}` as const,
      descriptorDigest: `sha256:${'2'.repeat(64)}` as const,
    };
    const previousComposition = compositionFixture({
      compositionDigest: `sha256:${'3'.repeat(64)}`,
      plugins: [
        {
          id: 'lifecycle-definition-builtin',
          version: '0.1.0',
          configDigest: `sha256:${'4'.repeat(64)}`,
          ...predecessor,
          authorities: ['lifecycle-definition'],
          stateSchemas: {},
        },
      ],
    });
    const currentComposition = compositionFixture({
      compositionDigest: `sha256:${'5'.repeat(64)}`,
      plugins: [
        {
          id: 'lifecycle-definition-builtin',
          version: '0.1.0',
          configDigest: `sha256:${'4'.repeat(64)}`,
          codeDigest: `sha256:${'6'.repeat(64)}`,
          descriptorDigest: `sha256:${'7'.repeat(64)}`,
          authorities: ['lifecycle-definition'],
          stateSchemas: {},
          compatibleImplementations: [predecessor],
        },
      ],
    });
    const runId = 'change-team-definition-recovery-order';
    const lifecycle = createChangeLifecycleSnapshot({
      identity: { workspaceId: 'team', changeId: 'definition-recovery-order', runId },
    });
    const initial = new WorkflowRunCoordinator(store, { async export() {} }, previousComposition);
    await initial.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture({ projectId: 'team' }),
      runId,
      changeLifecycle: lifecycle,
    });
    const predecessorDefinitionDigest =
      'sha256:ce969dbd7c17972b3cd438c585c7f0aebbeca046327ce2808659fdd8351a54f3' as const;
    let seededRevision = 0;
    await store.commitGuarded(runId, ({ state, trajectory }) => {
      const revision = state.changeLifecycle!.revision + 1;
      seededRevision = revision;
      const timestamp = '2026-11-01T00:00:00.000Z';
      const nextState = {
        ...state,
        status: 'migration_required' as const,
        changeLifecycle: {
          ...state.changeLifecycle!,
          definition: {
            id: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.id,
            version: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
            digest: predecessorDefinitionDigest,
          },
          revision,
          blocker: {
            code: 'change-lifecycle.definition-drift',
            message: 'seed direct predecessor definition drift',
            evidenceIds: [predecessorDefinitionDigest, lifecycle.definition.digest],
            sinceRevision: revision,
          },
        },
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: {
          schemaVersion: 1 as const,
          sequence: trajectory.length + 1,
          eventId: 'seed-definition-drift',
          timestamp,
          type: 'change.lifecycle.transitioned' as const,
          runId,
          stateVersion: nextState.stateVersion,
          compositionDigest: state.composition.compositionDigest,
          data: { reason: 'seed-definition-drift' },
        },
        value: undefined,
      };
    });

    const upgraded = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      currentComposition,
    );
    await upgraded.recoverChangeLifecycleDefinition(runId);

    const recovered = await store.loadRun(runId);
    expect(recovered.composition.compositionDigest).toBe(currentComposition.compositionDigest);
    expect(recovered.status).toBe('migration_required');
    expect(recovered.changeLifecycle).toMatchObject({
      revision: seededRevision,
      definition: { digest: predecessorDefinitionDigest },
      blocker: { code: 'change-lifecycle.definition-drift' },
    });
    const trajectory = await store.loadTrajectory(runId);
    expect(trajectory.at(-1)?.type).toBe('composition.changed');
  });

  it('upgrades compatible lifecycle Contributors and blocks incompatible recovery drift', async () => {
    const workspace = await temporaryDirectory('repoctopus-lifecycle-contributor-drift-');
    cleanup.push(workspace);
    const identity = (options: {
      id: string;
      version: string;
      code: string;
      compatibleWith?: string[];
    }) =>
      lifecycleContributorIdentity({
        kind: 'validator',
        id: options.id,
        version: options.version,
        codeDigest: `sha256:${options.code.repeat(64)}`,
        configDigest: `sha256:${'a'.repeat(64)}`,
        ...(options.compatibleWith ? { compatibleWith: options.compatibleWith } : {}),
      });
    const before = lifecycleContributorSnapshot([
      identity({ id: 'team.a', version: '1.0.0', code: 'a' }),
      identity({ id: 'team.b', version: '1.0.0', code: 'b' }),
    ]);
    const reordered = lifecycleContributorSnapshot([...before.contributors].reverse());
    expect(reordered.digest).toBe(before.digest);

    const initial = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      undefined,
      undefined,
      undefined,
      undefined,
      before,
    );
    await initial.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-lifecycle-contributor-drift',
    });
    const compatibleSnapshot = lifecycleContributorSnapshot([
      identity({ id: 'team.a', version: '2.0.0', code: 'c', compatibleWith: ['1.0.0'] }),
      identity({ id: 'team.b', version: '1.0.0', code: 'b' }),
    ]);
    const compatible = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      undefined,
      undefined,
      undefined,
      undefined,
      compatibleSnapshot,
    );
    expect(
      (await compatible.status('run-lifecycle-contributor-drift')).lifecycleContributorCompatibility
        ?.status,
    ).toBe('compatible');
    await compatible.next('run-lifecycle-contributor-drift');
    expect(
      (await new FileRuntimeStore(workspace).loadRun('run-lifecycle-contributor-drift'))
        .lifecycleContributorSnapshot?.digest,
    ).toBe(compatibleSnapshot.digest);

    const incompatibleSnapshot = lifecycleContributorSnapshot([
      identity({ id: 'team.a', version: '2.0.0', code: 'd' }),
      identity({ id: 'team.b', version: '1.0.0', code: 'b' }),
    ]);
    const incompatible = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      undefined,
      undefined,
      undefined,
      undefined,
      incompatibleSnapshot,
    );
    expect(
      (await incompatible.status('run-lifecycle-contributor-drift'))
        .lifecycleContributorCompatibility?.status,
    ).toBe('migration_required');
    await expect(incompatible.next('run-lifecycle-contributor-drift')).rejects.toThrow(
      /lifecycle Contributors are migration_required/u,
    );
  });

  async function waitingAtEvidence(runtime: WorkflowRunCoordinator, runId: string) {
    await runtime.start({
      workflow: evidenceWorkflow(),
      projectSnapshot: projectFixture(),
      runId,
    });
    const inspect = await runtime.next(runId);
    await runtime.record({
      runId,
      actionId: inspect.value.state.pendingActionId!,
      status: 'succeeded',
      summary: 'inspection complete',
    });
    return runtime.next(runId);
  }

  it('isolates runs started from the same project snapshot', async () => {
    const workspace = await temporaryDirectory('repoctopus-run-isolation-');
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
    );
    const projectSnapshot = projectFixture();
    const workflow = workflowFixture();
    await runtime.start({ workflow, projectSnapshot, runId: 'run-isolated-a' });
    await runtime.start({ workflow, projectSnapshot, runId: 'run-isolated-b' });
    const first = await runtime.next('run-isolated-a');
    const second = await runtime.status('run-isolated-b');
    expect(first.value.state.pendingActionId).not.toBeNull();
    expect(second.state.pendingActionId).toBeNull();
    await expect(
      runtime.record({
        runId: 'run-isolated-b',
        actionId: first.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'wrong run',
      }),
    ).rejects.toThrow(/does not match pending action/i);
  });

  it('serializes concurrent writers and rejects the stale transition', async () => {
    const workspace = await temporaryDirectory('repoctopus-concurrent-writers-');
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
    );
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-concurrent-writers',
    });
    const proposed = await runtime.next('run-concurrent-writers');
    const actionId = proposed.value.state.pendingActionId!;
    const results = await Promise.allSettled([
      runtime.record({
        runId: 'run-concurrent-writers',
        actionId,
        status: 'succeeded',
        summary: 'writer one',
        eventId: 'event-writer-one',
      }),
      runtime.record({
        runId: 'run-concurrent-writers',
        actionId,
        status: 'succeeded',
        summary: 'writer two',
        eventId: 'event-writer-two',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await runtime.status('run-concurrent-writers')).trajectoryLength).toBe(3);
  });

  it('allows only one concurrent initializer for the same run identity', async () => {
    const workspace = await temporaryDirectory('repoctopus-concurrent-start-');
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
    );
    const options = {
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-concurrent-start',
    };
    const results = await Promise.allSettled([runtime.start(options), runtime.start(options)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await runtime.status(options.runId)).trajectoryLength).toBe(1);
  });

  it('replays telemetry backlog and records outcomes idempotently', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-');
    cleanup.push(workspace);
    const telemetry = new FlakyTelemetry();
    let tick = 0;
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      telemetry,
      compositionFixture(),
      () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      () => `uuid-${tick}`,
    );
    const started = await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-runtime-1',
    });
    expect(started.diagnostics[0]?.code).toBe('telemetry.export-failed');
    const resumedRuntime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      telemetry,
      compositionFixture(),
      () => new Date(Date.UTC(2026, 0, 1, 0, 1, tick++)),
      () => `resumed-${tick}`,
    );
    const proposed = await resumedRuntime.next('run-runtime-1');
    expect(telemetry.batches[0]?.events.map((event) => event.type)).toEqual([
      'run.started',
      'action.proposed',
    ]);
    const actionId = proposed.value.state.pendingActionId!;
    const recorded = await resumedRuntime.record({
      runId: 'run-runtime-1',
      actionId,
      status: 'succeeded',
      summary: 'verified',
      eventId: 'event-runtime-1',
    });
    const replay = await resumedRuntime.record({
      runId: 'run-runtime-1',
      actionId,
      status: 'succeeded',
      summary: 'ignored duplicate payload',
      eventId: 'event-runtime-1',
    });
    expect(recorded.value.trajectoryLength).toBe(3);
    expect(replay.value.trajectoryLength).toBe(3);
    expect(replay.diagnostics[0]?.code).toBe('runtime.idempotent-replay');
  });

  it('blocks new decisions when repositories changed after a checkpoint', async () => {
    const workspace = await temporaryDirectory('repoctopus-reconcile-');
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => 'resume-event',
    );
    const previous = projectFixture({
      repositories: [
        {
          id: 'repository-1',
          name: 'workspace',
          path: 'C:/project',
          remoteIdentity: 'example.com/team/project',
          branch: 'main',
          head: 'a'.repeat(40),
          worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
        },
      ],
    });
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: previous,
      runId: 'run-reconcile',
    });
    const current = projectFixture({ root: 'C:/different-project' });
    const [resumed, replayedResume] = await Promise.all([
      runtime.resume({
        runId: 'run-reconcile',
        currentProjectSnapshot: current,
      }),
      runtime.resume({
        runId: 'run-reconcile',
        currentProjectSnapshot: current,
      }),
    ]);
    expect(resumed.value.reconciliation.changed).toBe(true);
    expect(resumed.value.state.reconciliationRequired).toBe(true);
    expect(resumed.value.nextAction).toBeNull();
    expect(replayedResume.value.trajectoryLength).toBe(resumed.value.trajectoryLength);
    const blocked = await runtime.next('run-reconcile');
    expect(blocked.value.nextAction).toBeNull();
    expect(blocked.diagnostics[0]?.message).toMatch(/reconciliation/i);
  });

  it('reports content drift without globally blocking the recovered continuation', async () => {
    const workspace = await temporaryDirectory('repoctopus-content-drift-');
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => 'resume-content-event',
    );
    const previous = projectFixture({
      repositories: [
        {
          id: 'repository-1',
          name: 'workspace',
          path: 'C:/project',
          remoteIdentity: 'example.com/team/project',
          branch: 'main',
          head: 'a'.repeat(40),
          worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
        },
      ],
    });
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: previous,
      runId: 'run-content-drift',
    });
    const current = projectFixture({
      repositories: previous.repositories.map((repository, index) =>
        index === 0 ? { ...repository, head: 'b'.repeat(40) } : repository,
      ),
    });

    const resumed = await runtime.resume({
      runId: 'run-content-drift',
      currentProjectSnapshot: current,
    });

    expect(resumed.value.reconciliation).toMatchObject({
      changed: true,
      changeClass: 'content',
      requiresReconciliation: false,
    });
    expect(resumed.value.state.reconciliationRequired).toBe(false);
    expect(resumed.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'runtime.project-changed',
    );
  });

  it.each([
    ['branch', { branch: 'feature' }],
    ['remote', { remoteIdentity: 'example.com/other/project' }],
    ['topology', null],
  ] as const)('keeps %s identity drift fail closed', async (label, repositoryPatch) => {
    const workspace = await temporaryDirectory(`repoctopus-${label}-drift-`);
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => `resume-${label}-event`,
    );
    const repository = {
      id: 'repository-1',
      name: 'workspace',
      path: 'C:/project',
      remoteIdentity: 'example.com/team/project',
      branch: 'main',
      head: 'a'.repeat(40),
      worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
    };
    const previous = projectFixture({ repositories: [repository] });
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: previous,
      runId: `run-${label}-drift`,
    });
    const current = projectFixture({
      repositories:
        repositoryPatch === null
          ? [repository, { ...repository, id: 'repository-2', name: 'worker' }]
          : [{ ...repository, ...repositoryPatch }],
    });

    const resumed = await runtime.resume({
      runId: `run-${label}-drift`,
      currentProjectSnapshot: current,
      ...(label === 'branch'
        ? {
            authorizedReconciliation: {
              kind: 'authorized-protected-branch-rebind' as const,
              authorizationDigest: `sha256:${'f'.repeat(64)}` as const,
              projectReconciliationDigest: projectReconciliationDigest(
                reconcileProjectSnapshots(previous, current),
              ),
            },
          }
        : {}),
    });

    expect(resumed.value.reconciliation).toMatchObject({
      changeClass: 'identity',
      requiresReconciliation: true,
    });
    expect(resumed.value.state.reconciliationRequired).toBe(true);
    expect(resumed.value.nextAction).toBeNull();
  });

  it('keeps the frozen workflow and reports source drift', async () => {
    const workspace = await temporaryDirectory('repoctopus-workflow-drift-');
    cleanup.push(workspace);
    const original = workflowFixture();
    const changed = workflowFixture();
    changed.definition.metadata.version = '2.0.0';
    changed.digest = 'changed-workflow-digest';
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => 'unused',
      { load: () => Promise.resolve(changed) },
    );
    await runtime.start({
      workflow: original,
      workflowSource: 'workflows/project.yaml',
      projectSnapshot: projectFixture(),
      runId: 'run-workflow-drift',
    });
    const status = await runtime.status('run-workflow-drift');
    expect(status.state.workflowDigest).toBe(original.digest);
    expect(status.workflowDrift).toMatchObject({
      checked: true,
      changed: true,
      expectedDigest: original.digest,
      currentDigest: changed.digest,
    });
  });

  it('rejects a manually reported success for an evidence-protected step', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-evidence-required-');
    cleanup.push(workspace);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
    );
    const waiting = await waitingAtEvidence(runtime, 'run-evidence-required');
    await expect(
      runtime.record({
        runId: 'run-evidence-required',
        actionId: waiting.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'manual success',
      }),
    ).rejects.toThrow(/Runtime evidence attempt/i);
    expect((await runtime.status('run-evidence-required')).state.status).toBe('waiting');
  });

  it('re-evaluates a bound Evidence Gate and records it in the transition', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-evidence-gate-');
    cleanup.push(workspace);
    const evaluations: Parameters<EvidenceGatePort['evaluate']>[0][] = [];
    const gate: EvidenceGatePort = {
      evaluate(input) {
        evaluations.push(input);
        return Promise.resolve({
          schemaVersion: 2,
          kind: 'EvidenceGateProjection',
          workflowRunId: input.workflowRunId,
          workflowActionId: input.workflowActionId,
          workflowStepId: input.workflowStepId,
          workflowStateVersion: input.workflowStateVersion ?? null,
          checkEpoch: input.checkEpoch ?? null,
          compositionDigest: compositionFixture().compositionDigest,
          profileId: input.profileId,
          bundleId: 'bundle-verified',
          inputFingerprint: 'fingerprint-current',
          verificationInputDigest: null,
          acceptanceSetHash: null,
          outcome: 'passed',
          status: 'satisfied',
          reason: 'current Runtime evidence passed',
        });
      },
    };
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      undefined,
      undefined,
      undefined,
      gate,
    );
    const waiting = await waitingAtEvidence(runtime, 'run-evidence-gate');
    const completed = await runtime.record({
      runId: 'run-evidence-gate',
      actionId: waiting.value.state.pendingActionId!,
      status: 'succeeded',
      summary: 'verified by Runtime',
      evidenceAttemptId: 'attempt-verified',
    });
    expect(completed.value.state.status).toBe('completed');
    expect(evaluations).toEqual([
      expect.objectContaining({
        attemptId: 'attempt-verified',
        workflowRunId: 'run-evidence-gate',
        workflowActionId: waiting.value.state.pendingActionId,
        workflowStepId: waiting.value.state.currentStep,
        workflowStateVersion: waiting.value.state.stateVersion,
        profileId: 'verify',
      }),
    ]);
    const store = new FileRuntimeStore(workspace);
    const trajectory = await store.loadTrajectory('run-evidence-gate');
    expect(trajectory.at(-1)?.data).toMatchObject({
      evidenceAttemptId: 'attempt-verified',
      evidenceGate: {
        workflowRunId: 'run-evidence-gate',
        bundleId: 'bundle-verified',
        status: 'satisfied',
      },
    });
    expect(completed.value.state.acceptedEvidenceBundleIds).toEqual(['bundle-verified']);
    expect((await store.loadCheckpoint('run-evidence-gate')).acceptedEvidenceBundleIds).toEqual([
      'bundle-verified',
    ]);
  });

  it('keeps the protected step waiting when the Evidence Gate is blocked', async () => {
    const workspace = await temporaryDirectory('repoctopus-runtime-evidence-blocked-');
    cleanup.push(workspace);
    const gate: EvidenceGatePort = {
      evaluate(input) {
        return Promise.resolve({
          schemaVersion: 2,
          kind: 'EvidenceGateProjection',
          workflowRunId: input.workflowRunId,
          workflowActionId: input.workflowActionId,
          workflowStepId: input.workflowStepId,
          workflowStateVersion: input.workflowStateVersion ?? null,
          checkEpoch: input.checkEpoch ?? null,
          compositionDigest: compositionFixture().compositionDigest,
          profileId: input.profileId,
          bundleId: 'bundle-stale',
          inputFingerprint: 'fingerprint-stale',
          verificationInputDigest: null,
          acceptanceSetHash: null,
          outcome: 'incomplete',
          status: 'blocked',
          reason: 'inputs changed after verification',
        });
      },
    };
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(workspace),
      { async export() {} },
      compositionFixture(),
      undefined,
      undefined,
      undefined,
      gate,
    );
    const waiting = await waitingAtEvidence(runtime, 'run-evidence-blocked');
    await expect(
      runtime.record({
        runId: 'run-evidence-blocked',
        actionId: waiting.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'stale evidence',
        evidenceAttemptId: 'attempt-stale',
      }),
    ).rejects.toThrow(/inputs changed after verification/i);
    expect((await runtime.status('run-evidence-blocked')).state.status).toBe('waiting');
  });
});
