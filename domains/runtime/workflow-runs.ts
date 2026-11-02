import { createHash, randomUUID } from 'node:crypto';

import { decide, recordOutcome, startRun } from '../engine/loop.js';
import type { ActionOutcome, EngineAction, RunState, RunTriggerSnapshot } from '../engine/types.js';
import { reconcileProjectSnapshots } from '../project/snapshot.js';
import type { ProjectSnapshot } from '../project/types.js';
import type {
  DesktopActivationFact,
  TrajectoryEvent,
  TrajectoryEventType,
} from '../trajectory/types.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import type { CompositionIdentitySnapshot } from '../composition/types.js';
import { compareCompositions } from '../composition/compatibility.js';
import { sameSkillUsageSnapshot, type SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationUsageSnapshot } from '../specification/types.js';
import type {
  ResumeView,
  RunStatusView,
  RuntimeDiagnostic,
  RuntimeResult,
  TelemetryPort,
  WorkflowSourcePort,
  EvidenceGatePort,
  RunStorePort,
} from './types.js';
import { requireSatisfiedEvidenceGate } from './evidence-guard.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  recoverChangeLifecycleSnapshot,
} from '../change-lifecycle/definition.js';
import {
  evolveChangeLifecycle,
  projectChangeRun,
  type ChangeLifecycleObservation,
  type ChangeLifecycleSnapshot,
  type ChangeLifecycleState,
} from '../change-lifecycle/transition.js';
import {
  projectCommittedContinuation,
  projectLifecycleNextActions,
} from '../change-lifecycle/continuation.js';
import {
  compareLifecycleContributorSnapshots,
  type LifecycleContributorSnapshot,
} from '../change-lifecycle/contributors.js';

export interface StartWorkflowRunOptions {
  workflow: WorkflowPackage;
  projectSnapshot: ProjectSnapshot;
  runId?: string;
  workflowSource?: string;
  trigger?: RunTriggerSnapshot;
  changeLifecycle?: ChangeLifecycleSnapshot;
}

export type IdempotentStartWorkflowRunOptions = StartWorkflowRunOptions & { runId: string };

export interface IdempotentStartWorkflowRunResult {
  disposition: 'started' | 'resumed';
  status: RunStatusView;
}

export class RunIdentityConflictError extends Error {
  readonly code: string = 'runtime.run-identity-conflict';

  constructor(runId: string, field: string) {
    super(`Run identity conflict for ${runId}: ${field} changed`);
    this.name = 'RunIdentityConflictError';
  }
}

export class WorkspaceBindingConflictError extends RunIdentityConflictError {
  override readonly code = 'runtime.workspace-binding-conflict';

  constructor(runId: string) {
    super(runId, 'workspace binding');
    this.name = 'WorkspaceBindingConflictError';
  }
}

function stableEventId(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function lifecycleState(snapshot: ChangeLifecycleSnapshot): ChangeLifecycleState {
  return {
    schemaVersion: snapshot.schemaVersion,
    identity: structuredClone(snapshot.identity),
    definition: structuredClone(snapshot.definition),
    ...(snapshot.skillCompositionDigest
      ? { skillCompositionDigest: snapshot.skillCompositionDigest }
      : {}),
    revision: snapshot.revision,
    checkEpoch: snapshot.checkEpoch,
    phase: snapshot.phase,
    currentWork: structuredClone(snapshot.currentWork),
    waitCondition: structuredClone(snapshot.waitCondition),
    blocker: structuredClone(snapshot.blocker),
    ...(snapshot.tasks ? { tasks: structuredClone(snapshot.tasks) } : {}),
    ...(snapshot.workspaceIntent
      ? { workspaceIntent: structuredClone(snapshot.workspaceIntent) }
      : {}),
    ...(snapshot.buildProtocol ? { buildProtocol: structuredClone(snapshot.buildProtocol) } : {}),
    ...(snapshot.openApprovalDigest ? { openApprovalDigest: snapshot.openApprovalDigest } : {}),
    ...(snapshot.openApprovalInvalidated ? { openApprovalInvalidated: true } : {}),
    ...(snapshot.planningDigest ? { planningDigest: snapshot.planningDigest } : {}),
    ...(snapshot.adoptedCompletionClaimDigest
      ? { adoptedCompletionClaimDigest: snapshot.adoptedCompletionClaimDigest }
      : {}),
    ...(snapshot.verificationInput
      ? { verificationInput: structuredClone(snapshot.verificationInput) }
      : {}),
    ...(snapshot.verificationInvalidation
      ? { verificationInvalidation: structuredClone(snapshot.verificationInvalidation) }
      : {}),
    ...(snapshot.archiveDeliveryInput
      ? { archiveDeliveryInput: structuredClone(snapshot.archiveDeliveryInput) }
      : {}),
    ...(snapshot.specificationClosure
      ? { specificationClosure: structuredClone(snapshot.specificationClosure) }
      : {}),
    ...(snapshot.publicationReceipt
      ? { publicationReceipt: structuredClone(snapshot.publicationReceipt) }
      : {}),
  };
}

function compositionDependencyClosure(state: RunState): {
  pluginIds: string[];
  authorities: string[];
} {
  const work = state.changeLifecycle?.currentWork;
  return {
    pluginIds: [
      work?.actionSkill?.provider,
      ...(work?.augmentationSkills.map((skill) => skill.provider) ?? []),
      ...(work?.skillComposition?.layers.map((layer) => layer.skill.provider) ?? []),
    ].filter((value): value is string => Boolean(value)),
    authorities: [
      'run-store-write',
      'workflow-transition',
      'lifecycle-definition',
      'lifecycle-validator',
      ...(work?.capabilities ?? []),
    ],
  };
}

interface WorkExecutionRetirementFact {
  reason: 'workspace-intent-revision' | 'lifecycle-work-changed';
  retiredWorkId: string;
  retiredCheckEpoch: number;
  nextWorkId: string | null;
  nextCheckEpoch: number;
}

function retireMismatchedExecution(
  state: RunState,
  snapshot: ChangeLifecycleSnapshot,
  observation: ChangeLifecycleObservation,
): { state: RunState; fact: WorkExecutionRetirementFact | null } {
  const execution = state.workExecution;
  if (
    !execution ||
    (execution.workId === snapshot.currentWork?.workId &&
      execution.checkEpoch === snapshot.checkEpoch)
  ) {
    return { state, fact: null };
  }
  const stateWithoutExecution = structuredClone(state);
  delete stateWithoutExecution.workExecution;
  return {
    state: stateWithoutExecution,
    fact: {
      reason: ['workspace-intent-revision-required', 'workspace-intent-revised'].includes(
        observation.kind,
      )
        ? 'workspace-intent-revision'
        : 'lifecycle-work-changed',
      retiredWorkId: execution.workId,
      retiredCheckEpoch: execution.checkEpoch,
      nextWorkId: snapshot.currentWork?.workId ?? null,
      nextCheckEpoch: snapshot.checkEpoch,
    },
  };
}

function event(options: {
  eventId: string;
  sequence: number;
  timestamp: string;
  type: TrajectoryEventType;
  state: RunState;
  data?: Record<string, unknown>;
}): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence: options.sequence,
    eventId: options.eventId,
    timestamp: options.timestamp,
    type: options.type,
    runId: options.state.runId,
    stateVersion: options.state.stateVersion,
    compositionDigest: options.state.composition.compositionDigest,
    data: options.data ?? {},
  };
}

export class WorkflowRunCoordinator {
  constructor(
    private readonly store: RunStorePort,
    private readonly telemetry: TelemetryPort,
    private readonly composition: CompositionIdentitySnapshot,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = () => randomUUID(),
    private readonly workflowSource?: WorkflowSourcePort,
    private readonly evidenceGate?: EvidenceGatePort,
    private readonly lifecycleContributors?: LifecycleContributorSnapshot,
  ) {}

  async start(options: StartWorkflowRunOptions): Promise<RuntimeResult<RunStatusView>> {
    const timestamp = this.clock().toISOString();
    const initial = startRun({
      workflow: options.workflow,
      runId: options.runId ?? this.uuid(),
      projectSnapshotDigest: options.projectSnapshot.digest,
      composition: this.composition,
      timestamp,
      ...(options.workflowSource ? { workflowSource: options.workflowSource } : {}),
      ...(options.trigger ? { trigger: options.trigger } : {}),
    });
    const state: RunState = options.changeLifecycle
      ? {
          ...initial,
          status: options.changeLifecycle.status,
          changeLifecycle: lifecycleState(options.changeLifecycle),
        }
      : initial;
    if (this.lifecycleContributors) {
      state.lifecycleContributorSnapshot = structuredClone(this.lifecycleContributors);
    }
    const started = event({
      eventId: stableEventId(state.runId, 'run.started'),
      sequence: 1,
      timestamp,
      type: 'run.started',
      state,
      data: {
        workflowName: state.workflowName,
        workflowVersion: state.workflowVersion,
        workflowRunResult: 'started',
        workflowDigest: state.workflowDigest,
        projectSnapshotDigest: state.projectSnapshotDigest,
        compositionDigest: state.composition.compositionDigest,
        repositoryCount: options.projectSnapshot.repositories.length,
        ...(state.trigger
          ? {
              triggerKind: state.trigger.kind,
              triggerIdentityDigest: state.trigger.identityDigest,
            }
          : {}),
        ...(state.changeLifecycle
          ? {
              changeId: state.changeLifecycle.identity.changeId,
              phase: state.changeLifecycle.phase,
              checkEpoch: state.changeLifecycle.checkEpoch,
              definition: state.changeLifecycle.definition,
            }
          : {}),
      },
    });
    await this.store.initialize({
      state,
      workflow: options.workflow,
      projectSnapshot: options.projectSnapshot,
      event: started,
    });
    const diagnostics = await this.flushTelemetry(state.runId);
    return { value: await this.status(state.runId), diagnostics };
  }

  async startOrResume(
    options: IdempotentStartWorkflowRunOptions,
  ): Promise<RuntimeResult<IdempotentStartWorkflowRunResult>> {
    try {
      const started = await this.start(options);
      return {
        value: { disposition: 'started', status: started.value },
        diagnostics: started.diagnostics,
      };
    } catch (startError) {
      let existing: RunStatusView;
      try {
        existing = await this.status(options.runId);
      } catch {
        throw startError;
      }
      this.assertSameStartIdentity(existing.state, options);
      if (existing.state.changeLifecycle)
        await this.recoverChangeLifecycleDefinition(options.runId);
      return {
        value: { disposition: 'resumed', status: await this.status(options.runId) },
        diagnostics: [
          {
            level: 'info',
            code: 'runtime.idempotent-start',
            message: `Run already exists and was resumed: ${options.runId}`,
          },
        ],
      };
    }
  }

  async status(runId: string): Promise<RunStatusView> {
    const [state, workflow, checkpoint, trajectory] = await Promise.all([
      this.store.loadRun(runId),
      this.store.loadWorkflow(runId),
      this.store.loadCheckpoint(runId),
      this.store.loadTrajectory(runId),
    ]);
    const preview = state.changeLifecycle ? null : decide(workflow, state, state.updatedAt);
    const pendingStep = state.pendingActionId
      ? workflow.definition.steps.find((step) => step.id === state.currentStep)
      : undefined;
    const pendingAction =
      pendingStep && state.pendingActionId
        ? { ...pendingStep.action, id: state.pendingActionId, stepId: pendingStep.id }
        : null;
    const workflowDrift = await this.inspectWorkflowDrift(state);
    const compositionCompatibility = compareCompositions(
      state.composition,
      this.composition,
      compositionDependencyClosure(state),
    );
    const lifecycleContributorCompatibility =
      state.lifecycleContributorSnapshot && this.lifecycleContributors
        ? compareLifecycleContributorSnapshots(
            state.lifecycleContributorSnapshot,
            this.lifecycleContributors,
          )
        : undefined;
    const latestVerifyObservation = [...trajectory]
      .reverse()
      .find(
        (entry) =>
          entry.data.observationKind === 'verify-gate-satisfied' ||
          entry.data.observationKind === 'verify-gate-rejected',
      )?.data.observation as { kind?: string; attemptId?: string } | undefined;
    const changeLifecycle = state.changeLifecycle
      ? projectChangeRun(
          { ...structuredClone(state.changeLifecycle), status: state.status },
          {
            taskProgress: {
              total: state.changeLifecycle.tasks?.length ?? 0,
              completed:
                state.changeLifecycle.tasks?.filter((task) => task.status === 'completed').length ??
                0,
              currentTaskId: state.changeLifecycle.currentWork?.taskId ?? null,
            },
            evidence: {
              gateStatus:
                latestVerifyObservation?.kind === 'verify-gate-satisfied'
                  ? 'satisfied'
                  : latestVerifyObservation?.kind === 'verify-gate-rejected'
                    ? 'failed'
                    : state.changeLifecycle.phase === 'verify'
                      ? 'pending'
                      : 'not-evaluated',
              acceptedBundleIds: [...state.acceptedEvidenceBundleIds],
              latestAttemptId: latestVerifyObservation?.attemptId ?? null,
            },
            nextActions: projectLifecycleNextActions({
              ...structuredClone(state.changeLifecycle),
              status: state.status,
            }),
            freshness: {
              stateVersion: state.stateVersion,
              trajectoryOffset: trajectory.length,
              observedAt: state.updatedAt,
            },
          },
        )
      : undefined;
    const continuation = state.changeLifecycle
      ? projectCommittedContinuation(checkpoint, trajectory)
      : undefined;
    return {
      state,
      checkpoint,
      trajectoryLength: trajectory.length,
      nextAction: state.changeLifecycle ? null : (pendingAction ?? preview?.action ?? null),
      workflowDrift,
      compositionCompatibility,
      ...(lifecycleContributorCompatibility ? { lifecycleContributorCompatibility } : {}),
      ...(changeLifecycle ? { changeLifecycle } : {}),
      ...(continuation ? { continuation } : {}),
      ...(preview?.reason ? { reason: preview.reason } : {}),
    };
  }

  async recoverChangeLifecycleDefinition(runId: string): Promise<void> {
    await this.prepareWritableComposition(runId);
    await this.store.commitGuarded(runId, ({ state, trajectory }) => {
      if (!state.changeLifecycle) return { value: undefined };
      const recovered = recoverChangeLifecycleSnapshot({
        persisted: { ...structuredClone(state.changeLifecycle), status: state.status },
        currentDefinition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      });
      if (!recovered.changed) return { value: undefined };
      const timestamp = this.clock().toISOString();
      const { status, ...changeLifecycle } = recovered.snapshot;
      const nextState: RunState = {
        ...state,
        status,
        changeLifecycle,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: event({
          eventId: stableEventId(runId, recovered.current.digest, 'definition-drift'),
          sequence: trajectory.length + 1,
          timestamp,
          type: 'change.lifecycle.transitioned',
          state: nextState,
          data: {
            reason:
              recovered.compatibility === 'compatible'
                ? 'compatible-definition-upgrade'
                : 'definition-drift',
            expectedDefinition: recovered.expected,
            currentDefinition: recovered.current,
            phase: changeLifecycle.phase,
            status,
          },
        }),
        value: undefined,
      };
    });
  }

  async acceptChangeObservation(
    runId: string,
    observation: ChangeLifecycleObservation,
  ): Promise<RuntimeResult<RunStatusView>> {
    await this.recoverChangeLifecycleDefinition(runId);
    await this.store.commitGuarded(runId, ({ state, trajectory }) => {
      if (!state.changeLifecycle) throw new Error(`Run is not a Change Run: ${runId}`);
      const observationDigest = createHash('sha256')
        .update(canonicalJson(observation))
        .digest('hex');
      const replayed = trajectory.some(
        (entry) =>
          entry.type === 'change.lifecycle.transitioned' &&
          (entry.data.observationDigest === observationDigest ||
            (entry.data.observation !== undefined &&
              canonicalJson(entry.data.observation) === canonicalJson(observation))),
      );
      if (replayed) return { value: undefined };
      if (
        (observation.kind === 'verify-gate-satisfied' ||
          observation.kind === 'verify-gate-rejected') &&
        observation.checkEpoch !== state.changeLifecycle.checkEpoch
      ) {
        throw new Error('Verify Gate is bound to a stale lifecycle checkEpoch');
      }
      const current: ChangeLifecycleSnapshot = {
        ...structuredClone(state.changeLifecycle),
        status: state.status,
      };
      const reduced = evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current,
        observation,
      });
      if (!reduced.fact) return { value: undefined };
      const timestamp = this.clock().toISOString();
      const { status, ...changeLifecycle } = reduced.snapshot;
      const retirement = retireMismatchedExecution(state, reduced.snapshot, observation);
      const nextState: RunState = {
        ...retirement.state,
        status,
        changeLifecycle,
        acceptedEvidenceBundleIds:
          observation.kind === 'verify-gate-satisfied'
            ? [...new Set([...state.acceptedEvidenceBundleIds, observation.bundleId])]
            : state.acceptedEvidenceBundleIds,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: event({
          eventId: stableEventId(runId, String(reduced.fact.revision), observationDigest),
          sequence: trajectory.length + 1,
          timestamp,
          type: 'change.lifecycle.transitioned',
          state: nextState,
          data: {
            changeLifecycleTransition: reduced.fact,
            observationKind: observation.kind,
            observationDigest,
            observation: structuredClone(observation),
            ...(retirement.fact ? { executionRetirement: structuredClone(retirement.fact) } : {}),
            ...(status === 'completed' || status === 'failed'
              ? {
                  workflowName: state.workflowName,
                  workflowVersion: state.workflowVersion,
                  workflowRunResult: status,
                  workflowRunDurationMs: Math.max(
                    0,
                    Date.parse(timestamp) - Date.parse(state.createdAt),
                  ),
                }
              : {}),
          },
        }),
        value: undefined,
      };
    });
    const diagnostics = await this.flushTelemetry(runId);
    return { value: await this.status(runId), diagnostics };
  }

  private assertSameStartIdentity(
    state: RunState,
    options: IdempotentStartWorkflowRunOptions,
  ): void {
    if (state.workflowDigest !== options.workflow.digest) {
      throw new RunIdentityConflictError(options.runId, 'workflow digest');
    }
    if (!state.changeLifecycle && state.projectSnapshotDigest !== options.projectSnapshot.digest) {
      throw new RunIdentityConflictError(options.runId, 'project snapshot digest');
    }
    if (state.workflowSource !== (options.workflowSource ?? null)) {
      throw new RunIdentityConflictError(options.runId, 'workflow source');
    }
    const existingBinding = state.trigger?.facts.changeStartBinding;
    const candidateBinding = options.trigger?.facts.changeStartBinding;
    if (canonicalJson(existingBinding ?? null) !== canonicalJson(candidateBinding ?? null)) {
      throw new WorkspaceBindingConflictError(options.runId);
    }
    if (canonicalJson(state.trigger ?? null) !== canonicalJson(options.trigger ?? null)) {
      throw new RunIdentityConflictError(options.runId, 'trigger facts');
    }
  }

  async bindSkill(runId: string, snapshot: SkillUsageSnapshot): Promise<SkillUsageSnapshot> {
    await this.prepareWritableComposition(runId);
    const result = await this.store.commitGuarded(runId, ({ state, trajectory }) => {
      this.assertWritableComposition(state);
      const existing = (state.skillUsageSnapshots ?? []).find(
        (item) => item.name === snapshot.name,
      );
      if (existing) {
        if (!sameSkillUsageSnapshot(existing, snapshot)) {
          throw new Error(
            `Skill drift detected for ${snapshot.name}: Run is bound to ${existing.provider} ${existing.contentDigest}, current is ${snapshot.provider} ${snapshot.contentDigest}`,
          );
        }
        return { value: existing };
      }
      const timestamp = this.clock().toISOString();
      const nextState: RunState = {
        ...state,
        skillUsageSnapshots: [...(state.skillUsageSnapshots ?? []), structuredClone(snapshot)].sort(
          (left, right) => left.name.localeCompare(right.name),
        ),
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      const bound = event({
        eventId: stableEventId(runId, snapshot.name, snapshot.contentDigest, 'skill.bound'),
        sequence: trajectory.length + 1,
        timestamp,
        type: 'skill.bound',
        state: nextState,
        data: {
          skillName: snapshot.name,
          skillProvider: snapshot.provider,
          contentDigest: snapshot.contentDigest,
          resourceManifestDigest: snapshot.resourceManifestDigest,
        },
      });
      return { state: nextState, event: bound, value: snapshot };
    });
    await this.flushTelemetry(runId);
    return result;
  }

  async bindSpecification(
    runId: string,
    snapshot: SpecificationUsageSnapshot,
  ): Promise<SpecificationUsageSnapshot> {
    await this.prepareWritableComposition(runId);
    const result = await this.store.commitGuarded(runId, ({ state, trajectory }) => {
      this.assertWritableComposition(state);
      const existing = state.specificationUsageSnapshot;
      if (existing) {
        if (
          existing.changeId !== snapshot.changeId ||
          existing.provider.id !== snapshot.provider.id ||
          existing.provider.version !== snapshot.provider.version ||
          existing.provider.protocolVersion !== snapshot.provider.protocolVersion ||
          existing.validationDigest !== snapshot.validationDigest
        ) {
          throw new Error(`Specification drift detected for Run ${runId}`);
        }
        return { value: existing };
      }
      const timestamp = this.clock().toISOString();
      const nextState: RunState = {
        ...state,
        specificationUsageSnapshot: structuredClone(snapshot),
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      const bound = event({
        eventId: stableEventId(
          runId,
          snapshot.changeId,
          snapshot.validationDigest,
          'specification.bound',
        ),
        sequence: trajectory.length + 1,
        timestamp,
        type: 'specification.bound',
        state: nextState,
        data: {
          changeId: snapshot.changeId,
          providerId: snapshot.provider.id,
          providerVersion: snapshot.provider.version,
          validationDigest: snapshot.validationDigest,
        },
      });
      return { state: nextState, event: bound, value: snapshot };
    });
    await this.flushTelemetry(runId);
    return result;
  }

  async bindSpecificationClosurePlan(
    runId: string,
    plan: {
      changeId: string;
      provider: { id: string; version: string };
      planDigest: `sha256:${string}`;
    },
  ): Promise<SpecificationUsageSnapshot> {
    await this.prepareWritableComposition(runId);
    const result = await this.store.commitGuarded(runId, ({ state, trajectory }) => {
      this.assertWritableComposition(state);
      const existing = state.specificationUsageSnapshot;
      if (!existing) throw new Error(`Run ${runId} has no bound Specification validation`);
      if (
        existing.changeId !== plan.changeId ||
        existing.provider.id !== plan.provider.id ||
        existing.provider.version !== plan.provider.version
      ) {
        throw new Error(`Specification closure plan does not match Run ${runId}`);
      }
      if (existing.closurePlanDigest) {
        if (existing.closurePlanDigest !== plan.planDigest) {
          throw new Error(`Specification closure plan drift detected for Run ${runId}`);
        }
        return { value: existing };
      }
      const timestamp = this.clock().toISOString();
      const snapshot = { ...existing, closurePlanDigest: plan.planDigest };
      const nextState: RunState = {
        ...state,
        specificationUsageSnapshot: snapshot,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: event({
          eventId: stableEventId(runId, plan.planDigest, 'specification.closure-planned'),
          sequence: trajectory.length + 1,
          timestamp,
          type: 'specification.closure-planned',
          state: nextState,
          data: {
            changeId: plan.changeId,
            providerId: plan.provider.id,
            closurePlanDigest: plan.planDigest,
          },
        }),
        value: snapshot,
      };
    });
    await this.flushTelemetry(runId);
    return result;
  }

  /** Persists one idempotent application-side fact without changing lifecycle phase or Work. */
  async recordDesktopActivation(
    runId: string,
    intentId: `sha256:${string}`,
    fact: DesktopActivationFact,
  ): Promise<RuntimeDiagnostic[]> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(intentId)) {
      throw new Error('Desktop activation intent identity must be a sha256 digest');
    }
    await this.prepareWritableComposition(runId);
    await this.store.commitGuarded(runId, ({ state, trajectory }) => {
      this.assertWritableComposition(state);
      const eventId = stableEventId(runId, intentId, 'desktop.activation');
      if (trajectory.some((candidate) => candidate.eventId === eventId)) {
        return { value: undefined };
      }
      const timestamp = this.clock().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: event({
          eventId,
          sequence: trajectory.length + 1,
          timestamp,
          type: 'desktop.activation',
          state: nextState,
          data: { ...fact },
        }),
        value: undefined,
      };
    });
    return this.flushTelemetry(runId);
  }

  async next(
    runId: string,
    confirmations: ReadonlySet<string> = new Set(),
  ): Promise<RuntimeResult<RunStatusView>> {
    await this.prepareWritableComposition(runId);
    const [state, workflow, trajectory] = await Promise.all([
      this.store.loadRun(runId),
      this.store.loadWorkflow(runId),
      this.store.loadTrajectory(runId),
    ]);
    const timestamp = this.clock().toISOString();
    const decision = decide(workflow, state, timestamp, confirmations);
    if (!decision.action) {
      return {
        value: await this.status(runId),
        diagnostics: decision.reason
          ? [{ level: 'warning', code: 'runtime.no-action', message: decision.reason }]
          : [],
      };
    }
    const proposed = event({
      eventId: stableEventId(runId, String(state.stateVersion), decision.action.id, 'proposed'),
      sequence: trajectory.length + 1,
      timestamp,
      type: 'action.proposed',
      state: decision.state,
      data: { action: decision.action },
    });
    await this.store.commit({
      state: decision.state,
      event: proposed,
      previousStateVersion: state.stateVersion,
    });
    const diagnostics = await this.flushTelemetry(runId);
    return { value: await this.status(runId), diagnostics };
  }

  async record(options: {
    runId: string;
    actionId: string;
    status: ActionOutcome['status'];
    summary: string;
    eventId?: string;
    evidenceAttemptId?: string;
    actionReceiptId?: string;
    correlationReceiptId?: `sha256:${string}`;
  }): Promise<RuntimeResult<RunStatusView>> {
    const eventId = options.eventId ?? this.uuid();
    const duplicate = await this.store.findEvent(options.runId, eventId);
    if (duplicate) {
      return {
        value: await this.status(options.runId),
        diagnostics: [
          {
            level: 'info',
            code: 'runtime.idempotent-replay',
            message: `Event already recorded: ${eventId}`,
          },
        ],
      };
    }
    const timestamp = this.clock().toISOString();
    if (
      options.correlationReceiptId &&
      !/^sha256:[a-f0-9]{64}$/u.test(options.correlationReceiptId)
    ) {
      throw new Error('Workflow correlation Receipt ID must be a sha256 digest');
    }
    await this.prepareWritableComposition(options.runId);
    await this.store.commitGuarded(options.runId, async ({ state, workflow, trajectory }) => {
      this.assertWritableComposition(state);
      const step = workflow.definition.steps.find((item) => item.id === state.currentStep);
      const requiredProfile = step?.action.evidenceProfile;
      let evidenceGate;
      if (options.status === 'succeeded' && requiredProfile) {
        if (!step || !state.pendingActionId) {
          throw new Error('Evidence-protected transition has no current pending action');
        }
        evidenceGate = await requireSatisfiedEvidenceGate({
          gate: this.evidenceGate,
          workflowRunId: options.runId,
          workflowActionId: state.pendingActionId,
          workflowStepId: step.id,
          workflowStateVersion: state.stateVersion,
          profileId: requiredProfile,
          attemptId: options.evidenceAttemptId,
          compositionDigest: state.composition.compositionDigest,
        });
      }
      const outcome: ActionOutcome = {
        eventId,
        actionId: options.actionId,
        status: options.status,
        summary: options.summary,
      };
      const recordedState = recordOutcome(workflow, state, outcome, timestamp);
      const nextState = evidenceGate
        ? {
            ...recordedState,
            acceptedEvidenceBundleIds: [
              ...new Set([...recordedState.acceptedEvidenceBundleIds, evidenceGate.bundleId]),
            ],
          }
        : recordedState;
      const completed = event({
        eventId,
        sequence: trajectory.length + 1,
        timestamp,
        type: 'action.completed',
        state: nextState,
        data: {
          actionId: options.actionId,
          result: options.status,
          summary: options.summary,
          ...(options.evidenceAttemptId ? { evidenceAttemptId: options.evidenceAttemptId } : {}),
          ...(options.actionReceiptId ? { actionReceiptId: options.actionReceiptId } : {}),
          ...(options.correlationReceiptId
            ? { correlationReceiptId: options.correlationReceiptId }
            : {}),
          ...(evidenceGate ? { evidenceGate } : {}),
          ...(nextState.status === 'completed' || nextState.status === 'failed'
            ? {
                workflowName: state.workflowName,
                workflowVersion: state.workflowVersion,
                workflowRunResult: nextState.status,
                workflowRunDurationMs: Math.max(
                  0,
                  Date.parse(timestamp) - Date.parse(state.createdAt),
                ),
              }
            : {}),
        },
      });
      return { state: nextState, event: completed, value: undefined };
    });
    const diagnostics = await this.flushTelemetry(options.runId);
    return { value: await this.status(options.runId), diagnostics };
  }

  async resume(options: {
    runId: string;
    currentProjectSnapshot: ProjectSnapshot;
  }): Promise<RuntimeResult<ResumeView>> {
    const recovered = await this.store.recover(options.runId);
    await this.prepareWritableComposition(options.runId);
    const previousSnapshot = await this.store.loadProjectSnapshot(options.runId);
    const reconciliation = reconcileProjectSnapshots(
      previousSnapshot,
      options.currentProjectSnapshot,
    );
    await this.store.commitGuarded(options.runId, ({ state, trajectory }) => {
      this.assertWritableComposition(state);
      const resumeBasis = [...trajectory]
        .reverse()
        .find((entry) => entry.type !== 'run.resumed' && entry.type !== 'recovery.reconciled');
      const resumeEventId = stableEventId(
        options.runId,
        resumeBasis?.eventId ?? 'run-start',
        options.currentProjectSnapshot.digest,
        reconciliation.requiresReconciliation ? 'recovery.reconciled' : 'run.resumed',
      );
      if (trajectory.some((entry) => entry.eventId === resumeEventId)) {
        return { value: undefined };
      }
      const timestamp = this.clock().toISOString();
      const nextState: RunState = {
        ...state,
        reconciliationRequired:
          state.reconciliationRequired || reconciliation.requiresReconciliation,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: event({
          eventId: resumeEventId,
          sequence: trajectory.length + 1,
          timestamp,
          type: reconciliation.requiresReconciliation ? 'recovery.reconciled' : 'run.resumed',
          state: nextState,
          data: { recoveredTransition: recovered, reconciliation },
        }),
        value: undefined,
      };
    });
    const diagnostics: RuntimeDiagnostic[] = reconciliation.requiresReconciliation
      ? [
          {
            level: 'warning',
            code: 'runtime.project-changed',
            message:
              'Project repositories changed after the checkpoint; dependent decisions require reconciliation',
          },
        ]
      : reconciliation.changeClass === 'content'
        ? [
            {
              level: 'info',
              code: 'runtime.project-content-changed',
              message:
                'Project content changed after the checkpoint; phase authority will revalidate dependent evidence',
            },
          ]
        : [];
    diagnostics.push(...(await this.flushTelemetry(options.runId)));
    return {
      value: { ...(await this.status(options.runId)), reconciliation },
      diagnostics,
    };
  }

  private assertWritableComposition(state: RunState): void {
    if (state.composition.compositionDigest !== this.composition.compositionDigest) {
      throw new Error(
        `Run ${state.runId} requires composition ${state.composition.compositionDigest}; current composition ${this.composition.compositionDigest} is migration_required`,
      );
    }
    if (state.lifecycleContributorSnapshot && this.lifecycleContributors) {
      const compatibility = compareLifecycleContributorSnapshots(
        state.lifecycleContributorSnapshot,
        this.lifecycleContributors,
      );
      if (compatibility.status === 'migration_required') {
        throw new Error(
          `Run ${state.runId} lifecycle Contributors are migration_required: ${compatibility.reason}`,
        );
      }
    }
  }

  private async prepareWritableComposition(runId: string): Promise<void> {
    const [state, trajectory] = await Promise.all([
      this.store.loadRun(runId),
      this.store.loadTrajectory(runId),
    ]);
    const compatibility = compareCompositions(
      state.composition,
      this.composition,
      compositionDependencyClosure(state),
    );
    const contributorCompatibility =
      state.lifecycleContributorSnapshot && this.lifecycleContributors
        ? compareLifecycleContributorSnapshots(
            state.lifecycleContributorSnapshot,
            this.lifecycleContributors,
          )
        : undefined;
    if (
      compatibility.status === 'same' &&
      (!contributorCompatibility || contributorCompatibility.status === 'same')
    ) {
      return;
    }
    if (compatibility.status === 'migration_required') {
      throw new Error(
        `Run ${state.runId} requires composition ${state.composition.compositionDigest}; current composition ${this.composition.compositionDigest} is migration_required: ${compatibility.reason}`,
      );
    }
    if (contributorCompatibility?.status === 'migration_required') {
      throw new Error(
        `Run ${state.runId} lifecycle Contributors are migration_required: ${contributorCompatibility.reason}`,
      );
    }
    const timestamp = this.clock().toISOString();
    const nextState: RunState = {
      ...state,
      composition: structuredClone(this.composition),
      ...(this.lifecycleContributors
        ? { lifecycleContributorSnapshot: structuredClone(this.lifecycleContributors) }
        : {}),
      stateVersion: state.stateVersion + 1,
      updatedAt: timestamp,
    };
    const changed = event({
      eventId: stableEventId(
        runId,
        state.composition.compositionDigest,
        this.composition.compositionDigest,
        'composition.changed',
      ),
      sequence: trajectory.length + 1,
      timestamp,
      type: 'composition.changed',
      state: nextState,
      data: {
        previousCompositionDigest: state.composition.compositionDigest,
        compositionDigest: this.composition.compositionDigest,
        changedPluginIds: compatibility.changedPluginIds,
        ...(contributorCompatibility
          ? { changedContributorIds: contributorCompatibility.changedContributorIds }
          : {}),
      },
    });
    await this.store.commit({
      state: nextState,
      event: changed,
      previousStateVersion: state.stateVersion,
    });
  }

  private async flushTelemetry(runId: string): Promise<RuntimeDiagnostic[]> {
    try {
      const [cursor, run, workflow, projectSnapshot, trajectory] = await Promise.all([
        this.store.readTelemetryCursor(runId),
        this.store.loadRun(runId),
        this.store.loadWorkflow(runId),
        this.store.loadProjectSnapshot(runId),
        this.store.loadTrajectory(runId),
      ]);
      const events = trajectory.filter((item) => item.sequence > cursor.trajectoryOffset);
      if (events.length === 0) return [];
      await this.telemetry.export({ run, workflow, projectSnapshot, events, trajectory });
      const last = events.at(-1);
      if (!last) return [];
      await this.store.writeTelemetryCursor({
        schemaVersion: 1,
        runId,
        trajectoryOffset: last.sequence,
        updatedAt: this.clock().toISOString(),
      });
      return [];
    } catch (error) {
      return [
        {
          level: 'warning',
          code: 'telemetry.export-failed',
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }

  private async inspectWorkflowDrift(state: RunState): Promise<RunStatusView['workflowDrift']> {
    const base = { expectedDigest: state.workflowDigest };
    if (!state.workflowSource || !this.workflowSource) {
      return { ...base, checked: false, changed: false };
    }
    try {
      const current = await this.workflowSource.load(state.workflowSource);
      return {
        ...base,
        checked: true,
        changed: current.digest !== state.workflowDigest,
        currentDigest: current.digest,
      };
    } catch (error) {
      return {
        ...base,
        checked: true,
        changed: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class NoopTelemetry implements TelemetryPort {
  async export(): Promise<void> {}
}

export function previewAction(status: RunStatusView): EngineAction | null {
  return status.nextAction;
}
