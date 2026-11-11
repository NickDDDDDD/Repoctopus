import {
  HUMAN_DECISION_HOST_INSTRUCTIONS,
  decisionCommands,
  decisionInteraction,
  parseLifecycleHumanDecisionResponse,
  requiresDecisionIsolation,
  type LifecycleDecisionKind,
  type LifecycleDecisionProvenance,
  type LifecycleHumanDecisionResponse,
  type HumanDecisionInteraction,
} from '../domains/change-lifecycle/human-decision.js';
import type { ExecutionIsolation } from '../domains/change-lifecycle/build-protocol.js';
import type { RunStorePort } from '../domains/runtime/types.js';
import type {
  SpecificationApprovalActor,
  SpecificationApprovalDecisionResponse,
  SpecificationApprovalRecord,
} from '../domains/specification/types.js';
import type { SpecificationPlanning } from './specification-planning.js';

export interface ReadLifecycleDecisionInput {
  runId: string;
  requestId?: string;
  proposalHash?: string;
}
export interface ApplyLifecycleDecisionInput {
  runId: string;
  response: SpecificationApprovalDecisionResponse;
  actor: SpecificationApprovalActor;
  isolation?: ExecutionIsolation;
  interaction?: HumanDecisionInteraction;
}
export interface LifecycleHumanDecisionView {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'LifecycleHumanDecisionView';
  runId: string;
  changeId: string;
  phase: 'open' | 'design' | 'build' | null;
  currentPhase: string;
  currentStatus: string;
  status: 'none' | 'pending' | 'accepted' | 'superseded' | 'not-found' | 'not-applied';
  currentRequest: boolean;
  requiresSubmission: boolean;
  runParticipation: 'waiting' | 'adopted' | 'historical' | 'none';
  decisionKind: LifecycleDecisionKind | null;
  requestId: string | null;
  proposalHash: string | null;
  authorityScope: 'planning-change' | 'run' | null;
  recordedViaRunId: string | null;
  decision: SpecificationApprovalRecord | LifecycleDecisionProvenance | null;
  selectedIsolation: ExecutionIsolation | null;
  materials: unknown;
  choices: readonly string[];
  requiredInputs: { approve: readonly string[] };
  responseTemplate: Record<string, unknown> | null;
  commands: ReturnType<typeof decisionCommands>;
  hostInstructions: readonly string[];
}

/** A facade over the two existing authorities. It owns neither a Store nor a phase. */
export class LifecycleHumanDecisions {
  constructor(
    private readonly ports: {
      store: Pick<RunStorePort, 'recover' | 'loadRun' | 'loadTrajectory'>;
      planning: Pick<SpecificationPlanning, 'status' | 'assertCurrentProposal'>;
      apply: (input: ApplyLifecycleDecisionInput) => Promise<unknown>;
    },
  ) {}

  async read(input: ReadLifecycleDecisionInput): Promise<LifecycleHumanDecisionView> {
    if (Boolean(input.requestId) !== Boolean(input.proposalHash))
      throw new Error('request-id and proposal-hash must be provided together');
    await this.ports.store.recover(input.runId);
    const state = await this.ports.store.loadRun(input.runId);
    const lifecycle = state.changeLifecycle;
    if (!lifecycle) throw new Error('Human Decision requires a Change Run');
    const wait =
      lifecycle.waitCondition?.kind === 'human-decision' ? lifecycle.waitCondition : null;
    const requestId = input.requestId ?? wait?.requestId;
    const proposalHash = input.proposalHash ?? wait?.proposalDigest;
    const currentRequest =
      !!wait && wait.requestId === requestId && wait.proposalDigest === proposalHash;
    const view: LifecycleHumanDecisionView = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'LifecycleHumanDecisionView',
      runId: input.runId,
      changeId: lifecycle.identity.changeId,
      phase: null,
      currentPhase: lifecycle.phase,
      currentStatus: state.status,
      status: requestId ? 'not-found' : 'none',
      currentRequest,
      requiresSubmission: false,
      runParticipation: currentRequest ? 'waiting' : 'none',
      decisionKind: null,
      requestId: requestId ?? null,
      proposalHash: proposalHash ?? null,
      authorityScope: null,
      recordedViaRunId: null,
      decision: null,
      selectedIsolation: null,
      materials: null,
      choices: [],
      requiredInputs: { approve: [] },
      responseTemplate: null,
      commands: decisionCommands(input.runId, requestId, proposalHash),
      hostInstructions: HUMAN_DECISION_HOST_INSTRUCTIONS,
    };
    if (!requestId || !proposalHash) return view;
    const events = await this.ports.store.loadTrajectory(input.runId);
    // Prove participation in this Run before consulting the shared change/phase approval Store.
    const observations = events
      .filter((event) => event.type === 'change.lifecycle.transitioned')
      .map((event) => event.data.observation as Record<string, unknown> | undefined)
      .filter(
        (observation): observation is Record<string, unknown> =>
          !!observation &&
          observation.requestId === requestId &&
          (observation.proposalDigest === proposalHash ||
            (observation.kind === 'build-plan-approval-required' &&
              (observation.evidence as { validationDigest?: string })?.validationDigest ===
                proposalHash)),
      );
    const participated = observations.find((observation) =>
      [
        'open-gate',
        'design-gate',
        'workspace-intent-revision-required',
        'build-plan-approval-required',
      ].includes(String(observation.kind)),
    );
    if (!currentRequest && !participated) return view;
    view.runParticipation = currentRequest
      ? 'waiting'
      : observations.some(
            (observation) =>
              (observation.kind === 'open-gate' || observation.kind === 'design-gate') &&
              observation.result === 'approved',
          )
        ? 'adopted'
        : 'historical';
    const waitId = currentRequest ? wait.waitId : String(participated?.kind);
    const decisionKind: LifecycleDecisionKind = waitId.startsWith('workspace-intent')
      ? 'workspace-intent-revision'
      : waitId.startsWith('build-plan')
        ? 'build-plan-risk'
        : waitId.startsWith('design')
          ? 'specification-design'
          : 'specification-open';
    const phase =
      decisionKind === 'specification-design'
        ? 'design'
        : decisionKind === 'build-plan-risk'
          ? 'build'
          : 'open';
    Object.assign(view, {
      decisionKind,
      phase,
      authorityScope: decisionKind.startsWith('specification-') ? 'planning-change' : 'run',
      status: currentRequest ? 'pending' : 'superseded',
    });
    if (decisionKind.startsWith('specification-')) {
      const approvalPhase = phase as 'open' | 'design';
      const approval = await this.ports.planning.status(lifecycle.identity.changeId, approvalPhase);
      const root = state.trigger?.facts.specificationRoot as
        | { storeId?: string; repositoryId?: string }
        | undefined;
      if (
        !approval ||
        !root ||
        approval.snapshot.specificationRoot.storeId !== root.storeId ||
        approval.snapshot.specificationRoot.repositoryId !== root.repositoryId
      )
        return { ...view, status: 'not-found' };
      const same =
        approval.decisionRequest.requestId === requestId &&
        approval.decisionRequest.proposalHash === proposalHash;
      const historical = approval.decisionHistory?.find(
        (entry) => entry.requestId === requestId && entry.proposalHash === proposalHash,
      );
      if (!same && !historical) return { ...view, status: 'not-found' };
      const decision = same ? approval.decision : (historical?.decision ?? null);
      Object.assign(view, {
        status: !same
          ? 'superseded'
          : decision
            ? 'accepted'
            : currentRequest
              ? 'pending'
              : 'superseded',
        decision,
        recordedViaRunId: decision?.recordedViaRunId ?? null,
        materials: same
          ? {
              request: approval.decisionRequest,
              specificationRoot: approval.snapshot.specificationRoot,
            }
          : { historical: true },
        choices: same ? approval.decisionRequest.options : [],
        selectedIsolation:
          phase === 'open'
            ? ((currentRequest ? lifecycle.workspaceIntent?.isolation : undefined) ??
              (
                observations.find(
                  (observation) => observation.kind === 'open-workspace-intent-selected',
                )?.intent as { isolation?: ExecutionIsolation } | undefined
              )?.isolation ??
              null)
            : null,
      });
    } else {
      const accepted = observations.find(
        (observation) =>
          observation.kind ===
          (decisionKind === 'build-plan-risk' ? 'build-plan-decision' : 'workspace-intent-revised'),
      );
      Object.assign(view, {
        status: accepted?.humanDecision ? 'accepted' : accepted ? 'superseded' : view.status,
        decision: accepted?.humanDecision ?? null,
        recordedViaRunId: accepted ? input.runId : null,
        materials: currentRequest
          ? {
              wait,
              ...(decisionKind === 'build-plan-risk'
                ? {
                    plan: lifecycle.buildProtocol?.plan,
                    evidence: lifecycle.buildProtocol?.planEvidence,
                  }
                : { intent: lifecycle.workspaceIntent }),
            }
          : { historical: participated },
        choices: ['approve', 'revise', 'reject'],
      });
    }
    view.requiresSubmission =
      view.status === 'pending' ||
      (view.status === 'accepted' &&
        currentRequest &&
        decisionKind === 'specification-open' &&
        view.decision?.decision === 'approve' &&
        !view.selectedIsolation);
    if (view.requiresSubmission) {
      view.requiredInputs = {
        approve: requiresDecisionIsolation(decisionKind) ? ['isolation'] : [],
      };
      view.responseTemplate = {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'LifecycleHumanDecisionResponse',
        runId: input.runId,
        phase,
        decisionKind,
        requestId,
        proposalHash,
        decision: null,
        interaction: { channel: null, authorization: null, reference: null },
      };
    }
    return view;
  }

  async submit(input: {
    runId: string;
    response: unknown;
    actor: SpecificationApprovalActor;
  }): Promise<LifecycleHumanDecisionView> {
    const response = parseLifecycleHumanDecisionResponse(input.response);
    if (response.runId !== input.runId)
      throw new Error('Human Decision response belongs to a different Run');
    return this.submitExisting(
      {
        runId: input.runId,
        actor: input.actor,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: response.requestId,
          proposalHash: response.proposalHash,
          decision: response.decision,
          ...(response.comment ? { comment: response.comment } : {}),
        },
        ...(response.isolation ? { isolation: response.isolation } : {}),
        interaction: decisionInteraction(response),
      },
      response,
    );
  }

  async submitExisting(
    input: ApplyLifecycleDecisionInput,
    assertions?: LifecycleHumanDecisionResponse,
  ): Promise<LifecycleHumanDecisionView> {
    if (!input.actor.authenticated || !input.actor.actorId.trim())
      throw new Error('Human Decision requires a trusted local actor');
    const view = await this.read({
      runId: input.runId,
      requestId: input.response.requestId,
      proposalHash: input.response.proposalHash,
    });
    if (
      assertions &&
      (assertions.phase !== view.phase || assertions.decisionKind !== view.decisionKind)
    )
      throw new Error('Human Decision does not match the original phase and kind');
    if (view.status === 'accepted' && view.decision) {
      if (
        view.decision.decision !== input.response.decision ||
        (requiresDecisionIsolation(view.decisionKind!) &&
          input.response.decision === 'approve' &&
          view.selectedIsolation &&
          view.selectedIsolation !== input.isolation) ||
        (view.authorityScope === 'run' &&
          'isolation' in view.decision &&
          view.decision.isolation !== input.isolation)
      )
        throw new Error('Human Decision conflicts with the original accepted choice or isolation');
      // Shared planning approval does not select another Run's execution isolation.
      if (
        view.currentRequest &&
        view.decisionKind === 'specification-open' &&
        input.response.decision === 'approve' &&
        !view.selectedIsolation
      ) {
        if (!input.isolation || !['current', 'branch', 'worktree'].includes(input.isolation))
          throw new Error('Open approval requires an explicit valid isolation');
        await this.ports.apply(input);
        return this.read({
          runId: input.runId,
          requestId: input.response.requestId,
          proposalHash: input.response.proposalHash,
        });
      }
      return view;
    }
    if (
      view.status !== 'pending' ||
      !view.currentRequest ||
      !view.decisionKind ||
      !view.choices.includes(input.response.decision)
    )
      throw new Error(
        'Human Decision request is stale, superseded, or not attributable to this Run',
      );
    if (input.response.decision === 'approve' && requiresDecisionIsolation(view.decisionKind)) {
      if (!input.isolation || !['current', 'branch', 'worktree'].includes(input.isolation))
        throw new Error('Human Decision approval requires an explicit valid isolation');
      if (view.selectedIsolation && view.selectedIsolation !== input.isolation)
        throw new Error('Human Decision cannot replace the already selected isolation');
    } else if (input.isolation !== undefined)
      throw new Error('Isolation is not applicable to this Human Decision');
    if (view.decisionKind.startsWith('specification-'))
      await this.ports.planning.assertCurrentProposal(
        view.changeId,
        view.phase as 'open' | 'design',
        input.response.requestId,
        input.response.proposalHash,
      );
    await this.ports.apply(input);
    if (view.decisionKind === 'workspace-intent-revision' && input.response.decision !== 'approve')
      return { ...view, status: 'not-applied' };
    return this.read({
      runId: input.runId,
      requestId: input.response.requestId,
      proposalHash: input.response.proposalHash,
    });
  }
}
