import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { ActionIntent, ActionReceipt, ClaimedActionOutcome } from '../domains/action/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type {
  SpecificationArtifact,
  SpecificationValidation,
} from '../domains/specification/types.js';
import type { TrajectoryEvent, TrajectoryEventType } from '../domains/trajectory/types.js';
import type {
  AgentCoordinationCheckpoint,
  AgentCoordinationCheckpointView,
  WorkContinuationKind,
  WorkExecutionCheckpoint,
  WorkExecutionHostInvocation,
  WorkExecutionHostOutcome,
  WorkClaimResult,
  WorkExecutionPacket,
  WorkExecutionRecovery,
} from '../domains/work-execution/types.js';
import {
  appendRejectedWorkExecutionSubmission,
  classifyWorkExecutionSubmission,
  createWorkExecutionSubmission,
} from '../domains/work-execution/submission.js';
import type { WorkExecutionSubmissionRejectionCode } from '../domains/work-execution/types.js';

function digest(...parts: readonly string[]): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(parts.join('\0')).digest('hex')}`;
}

function rawDigest(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

function executionEvent(input: {
  state: RunState;
  sequence: number;
  timestamp: string;
  type: TrajectoryEventType;
  identity: readonly string[];
  data: Record<string, unknown>;
}): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence: input.sequence,
    eventId: digest(input.state.runId, input.type, ...input.identity),
    timestamp: input.timestamp,
    type: input.type,
    runId: input.state.runId,
    stateVersion: input.state.stateVersion,
    compositionDigest: input.state.composition.compositionDigest,
    data: input.data,
  };
}

function buildTelemetryFields(state: RunState, work: WorkDescriptor): Record<string, unknown> {
  if (work.phase !== 'build') return {};
  const configuration = state.changeLifecycle?.buildProtocol?.configuration;
  return {
    ...(work.buildAction ? { buildAction: work.buildAction } : {}),
    ...(work.configurationId ? { configurationId: work.configurationId } : {}),
    ...(work.planId ? { planId: work.planId } : {}),
    ...(work.planRevision === undefined ? {} : { planRevision: work.planRevision }),
    ...(work.packageId ? { packageId: work.packageId } : {}),
    ...(configuration
      ? {
          executionMode: configuration.executionMode,
          tddMode: configuration.tddMode,
          reviewMode: configuration.reviewMode,
          isolation: configuration.isolation,
        }
      : state.changeLifecycle?.workspaceIntent
        ? { isolation: state.changeLifecycle.workspaceIntent.isolation }
        : {}),
  };
}

function assertActivePacket(state: RunState, packet: WorkExecutionPacket): void {
  const work = state.changeLifecycle?.currentWork;
  if (
    state.status !== 'running' ||
    !work ||
    state.runId !== packet.claim.runId ||
    work.workId !== packet.claim.workId ||
    work.inputDigest !== packet.claim.inputDigest ||
    work.checkEpoch !== packet.claim.checkEpoch ||
    state.changeLifecycle?.checkEpoch !== packet.claim.checkEpoch ||
    work.workId !== packet.work.workId ||
    packet.identity.contextDigest !== packet.context.digest
  ) {
    throw new Error('Work execution packet is not attached to the active Run Work');
  }
}

function assertSameClaim(checkpoint: WorkExecutionCheckpoint, intent: ActionIntent): void {
  if (
    checkpoint.workId !== intent.workId ||
    checkpoint.attempt !== intent.attempt ||
    checkpoint.checkEpoch !== intent.checkEpoch ||
    checkpoint.intentId !== intent.intentId ||
    checkpoint.claimToken !== intent.claimToken ||
    checkpoint.inputDigest !== intent.inputDigest
  ) {
    throw new Error('Action identity is not the authoritative Run claim');
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if ((current as NodeJS.ErrnoException).code === code) return true;
    current = current.cause;
  }
  return false;
}

export class WorkExecutionAuthority extends Service {
  static inject = [
    'runStore',
    'actionStore',
    'workExecutionPacketStore',
    'workExecutionSessions',
    'workflowTelemetry',
  ];

  constructor(context: Context) {
    super(context, 'workExecutionAuthority');
  }

  async bindClaim(packet: WorkExecutionPacket): Promise<WorkExecutionCheckpoint> {
    const stored = await this.ctx.workExecutionPacketStore.save(packet);
    const result = await this.ctx.runStore.commitGuarded(
      packet.claim.runId,
      ({ state, trajectory }) => {
        assertActivePacket(state, packet);
        const existing = state.workExecution;
        if (existing) {
          if (
            existing.workId === packet.claim.workId &&
            existing.attempt === packet.claim.attempt &&
            existing.intentId === packet.claim.intentId &&
            existing.packet.packetDigest === packet.identity.packetDigest
          ) {
            return { value: structuredClone(existing) };
          }
          const retryAfterFailure =
            existing.workId === packet.claim.workId &&
            ((existing.status === 'outcome' && existing.actionOutcome?.status === 'failed') ||
              existing.status === 'not-executed') &&
            packet.claim.attempt === existing.attempt + 1;
          const nextAuthorizedWork =
            existing.workId !== packet.claim.workId &&
            (existing.status === 'validated' || existing.checkEpoch < packet.claim.checkEpoch);
          const nextAuthorizedEpochForSameWork =
            existing.workId === packet.claim.workId &&
            existing.checkEpoch < packet.claim.checkEpoch &&
            packet.claim.attempt > existing.attempt;
          if (!retryAfterFailure && !nextAuthorizedWork && !nextAuthorizedEpochForSameWork) {
            throw new Error(
              `Run already has an authoritative claim for ${existing.workId} attempt ${existing.attempt}`,
            );
          }
        }
        const timestamp = new Date().toISOString();
        const checkpoint: WorkExecutionCheckpoint = {
          schemaVersion: 3,
          workId: packet.claim.workId,
          attempt: packet.claim.attempt,
          checkEpoch: packet.claim.checkEpoch,
          intentId: packet.claim.intentId,
          claimToken: packet.claim.claimToken,
          inputDigest: packet.claim.inputDigest,
          packet: structuredClone(packet.identity),
          status: 'claimed',
          continuation: 'execute',
          updatedAt: timestamp,
        };
        const nextState: RunState = {
          ...state,
          workExecution: checkpoint,
          stateVersion: state.stateVersion + 1,
          updatedAt: timestamp,
        };
        return {
          state: nextState,
          event: executionEvent({
            state: nextState,
            sequence: trajectory.length + 1,
            timestamp,
            type: 'work.claimed',
            identity: [checkpoint.workId, String(checkpoint.attempt), checkpoint.intentId],
            data: {
              phase: packet.work.phase,
              workId: checkpoint.workId,
              workKind: packet.work.kind,
              attempt: checkpoint.attempt,
              checkEpoch: checkpoint.checkEpoch,
              intentId: checkpoint.intentId,
              packetDigest: checkpoint.packet.packetDigest,
              continuation: checkpoint.continuation,
              ...buildTelemetryFields(state, packet.work),
            },
          }),
          value: structuredClone(checkpoint),
        };
      },
    );
    try {
      await this.recordEvent(
        packet.claim.runId,
        packet.claim.intentId,
        'work.packet-stored',
        {
          phase: packet.work.phase,
          workId: packet.work.workId,
          workKind: packet.work.kind,
          attempt: packet.claim.attempt,
          checkEpoch: packet.claim.checkEpoch,
          packetDigest: packet.identity.packetDigest,
          result: stored.status,
        },
        [packet.identity.packetDigest, stored.status],
      );
    } catch {
      // The packet and authoritative claim are already durable. Observability cannot
      // turn a successful bind into an apparent failure that a Runner might replay.
    }
    await this.flushTelemetry(packet.claim.runId);
    return result;
  }

  async recordPacketRecovery(
    runId: string,
    result: 'recovered' | 'missing' | 'corrupt' | 'legacy',
  ): Promise<void> {
    await this.ctx.runStore.commitGuarded(runId, ({ state, trajectory }) => {
      const execution = state.workExecution;
      if (!execution) throw new Error(`Run has no authoritative Work claim: ${runId}`);
      const eventId = digest(
        runId,
        'work.packet-recovered',
        execution.workId,
        String(execution.attempt),
        execution.packet.packetDigest,
        result,
      );
      if (trajectory.some((event) => event.eventId === eventId)) return { value: undefined };
      const timestamp = new Date().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type: 'work.packet-recovered',
          identity: [
            execution.workId,
            String(execution.attempt),
            execution.packet.packetDigest,
            result,
          ],
          data: {
            phase: state.changeLifecycle?.phase,
            workId: execution.workId,
            workKind: state.changeLifecycle?.currentWork?.kind,
            attempt: execution.attempt,
            checkEpoch: execution.checkEpoch,
            packetDigest: execution.packet.packetDigest,
            result,
          },
        }),
        value: undefined,
      };
    });
    await this.flushTelemetry(runId);
  }

  async recordPacketRecoveryFailure(runId: string, error: unknown): Promise<void> {
    const state = await this.ctx.runStore.loadRun(runId);
    await this.recordPacketRecovery(
      runId,
      state.workExecution?.schemaVersion !== 3
        ? 'legacy'
        : hasErrorCode(error, 'ENOENT')
          ? 'missing'
          : 'corrupt',
    );
  }

  async recordSpecificationObservations(input: {
    runId: string;
    artifacts: readonly SpecificationArtifact[];
    validation: SpecificationValidation;
  }): Promise<void> {
    const status = (kind: SpecificationArtifact['kind']): SpecificationArtifact['status'] =>
      input.artifacts.find((artifact) => artifact.kind === kind)?.status ?? 'missing';
    const artifactStatuses = {
      proposalStatus: status('proposal'),
      specsStatus: status('delta-specs'),
      designStatus: status('design'),
      tasksStatus: status('tasks'),
    } as const;
    const counts = { info: 0, warning: 0, error: 0 };
    for (const diagnostic of input.validation.diagnostics) counts[diagnostic.severity] += 1;
    const highestSeverity =
      counts.error > 0
        ? 'error'
        : counts.warning > 0
          ? 'warning'
          : counts.info > 0
            ? 'info'
            : 'none';
    const contractConflict = input.validation.diagnostics.some(
      ({ code }) => code === 'openspec.validation-contract-conflict',
    );
    const observations = [
      {
        type: 'specification.artifacts-observed' as const,
        identity: Object.values(artifactStatuses),
        data: artifactStatuses,
      },
      {
        type: 'specification.validation-observed' as const,
        identity: [input.validation.validationDigest],
        data: {
          valid: input.validation.valid,
          highestSeverity,
          infoCount: counts.info,
          warningCount: counts.warning,
          errorCount: counts.error,
          contractConflict,
        },
      },
    ];
    for (const observation of observations) {
      await this.ctx.runStore.commitGuarded(input.runId, ({ state, trajectory }) => {
        const eventId = digest(input.runId, observation.type, ...observation.identity);
        if (trajectory.some((event) => event.eventId === eventId)) return { value: undefined };
        const timestamp = new Date().toISOString();
        const nextState: RunState = {
          ...state,
          stateVersion: state.stateVersion + 1,
          updatedAt: timestamp,
        };
        return {
          state: nextState,
          event: executionEvent({
            state: nextState,
            sequence: trajectory.length + 1,
            timestamp,
            type: observation.type,
            identity: observation.identity,
            data: {
              phase: state.changeLifecycle?.phase,
              workId: state.workExecution?.workId,
              workKind: state.changeLifecycle?.currentWork?.kind,
              attempt: state.workExecution?.attempt,
              ...observation.data,
            },
          }),
          value: undefined,
        };
      });
    }
    await this.flushTelemetry(input.runId);
  }

  async recordWorkCreated(runId: string, work: WorkDescriptor): Promise<void> {
    await this.ctx.runStore.commitGuarded(runId, ({ state, trajectory }) => {
      const eventId = digest(runId, 'work.created', work.workId, work.inputDigest);
      if (trajectory.some((event) => event.eventId === eventId)) return { value: undefined };
      if (state.changeLifecycle?.currentWork?.workId !== work.workId) {
        throw new Error('Created Work is not the Runtime-selected current Work');
      }
      const timestamp = new Date().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type: 'work.created',
          identity: [work.workId, work.inputDigest],
          data: {
            phase: work.phase,
            workId: work.workId,
            workKind: work.kind,
            inputDigest: work.inputDigest,
            checkEpoch: work.checkEpoch,
            ...buildTelemetryFields(state, work),
          },
        }),
        value: undefined,
      };
    });
    await this.flushTelemetry(runId);
  }

  async markContextDelivered(packet: WorkExecutionPacket): Promise<WorkExecutionCheckpoint> {
    return this.transition(
      packet.claim.runId,
      packet.claim.intentId,
      ['claimed'],
      'work.context-delivered',
      'context-delivered',
      'execute',
      {
        workId: packet.claim.workId,
        attempt: packet.claim.attempt,
        packetDigest: packet.identity.packetDigest,
        contextDigest: packet.identity.contextDigest,
        layerCount: packet.context.layers.length,
      },
    );
  }

  async recordSkillFacts(
    packet: WorkExecutionPacket,
    stage: 'resolved' | 'delivered' | 'consumed',
    consumedLayerDigests?: readonly `sha256:${string}`[],
  ): Promise<void> {
    const eligible = packet.context.layers.filter(
      (layer) =>
        (layer.kind === 'action-skill' || layer.kind === 'augmentation-skill') &&
        (stage !== 'consumed' || consumedLayerDigests?.includes(layer.digest)),
    );
    for (const layer of eligible) {
      await this.recordEvent(
        packet.claim.runId,
        packet.claim.intentId,
        `skill.${stage}`,
        {
          phase: packet.work.phase,
          workId: packet.work.workId,
          workKind: packet.work.kind,
          attempt: packet.claim.attempt,
          packetDigest: packet.identity.packetDigest,
          skillName: layer.source,
          skillRole: layer.kind === 'action-skill' ? 'action' : 'augmentation',
          result: stage,
        },
        [layer.digest, stage],
      );
    }
  }

  async recordDelegationFacts(
    packet: WorkExecutionPacket,
    outcome: WorkExecutionHostOutcome,
  ): Promise<void> {
    for (const receipt of outcome.delegationReceipts ?? []) {
      await this.recordEvent(
        packet.claim.runId,
        packet.claim.intentId,
        'delegation.completed',
        {
          phase: packet.work.phase,
          workId: packet.work.workId,
          workKind: packet.work.kind,
          buildAction: packet.work.buildAction,
          attempt: packet.claim.attempt,
          invocationId: outcome.invocationId,
          executionId: receipt.executionId,
          packageId: receipt.packageId,
          delegationRole: receipt.role,
          result: receipt.status,
        },
        [receipt.receiptId, receipt.outcomeDigest],
      );
    }
  }

  async recordToolBoundary(input: {
    runId: string;
    intentId: string;
    invocationId: string;
    operationId: string;
    operationKind: string;
    stage: 'started' | 'completed';
    result?: 'succeeded' | 'failed';
    durationMs?: number;
  }): Promise<void> {
    await this.recordEvent(
      input.runId,
      input.intentId,
      `tool.${input.stage}`,
      {
        invocationId: input.invocationId,
        operationId: input.operationId,
        operationKind: input.operationKind,
        ...(input.result ? { result: input.result } : {}),
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      },
      [input.invocationId, input.operationId, input.stage],
    );
  }

  async markHostStarted(
    intent: ActionIntent,
    invocation: WorkExecutionHostInvocation,
  ): Promise<WorkExecutionCheckpoint> {
    const result = await this.transition(
      intent.runId,
      intent.intentId,
      ['context-delivered'],
      'work.host-started',
      'invoking',
      'wait',
      {
        workId: intent.workId,
        attempt: intent.attempt,
        invocationId: invocation.invocationId,
        hostId: invocation.host.id,
        packetDigest: invocation.packet.packetDigest,
      },
      { hostInvocation: structuredClone(invocation) },
    );
    return result;
  }

  async markHostUnknown(intent: ActionIntent, summary: string): Promise<WorkExecutionCheckpoint> {
    return this.transition(
      intent.runId,
      intent.intentId,
      ['invoking', 'submitted'],
      'reconcile.started',
      'unknown',
      'reconcile',
      { workId: intent.workId, attempt: intent.attempt, reason: summary },
    );
  }

  async markHostNotExecuted(
    intent: ActionIntent,
    reason: string,
  ): Promise<WorkExecutionCheckpoint> {
    return this.transition(
      intent.runId,
      intent.intentId,
      ['invoking', 'unknown'],
      'reconcile.completed',
      'not-executed',
      'execute',
      {
        workId: intent.workId,
        attempt: intent.attempt,
        result: 'not-executed',
        reason,
      },
    );
  }

  async markHostCompleted(
    intent: ActionIntent,
    outcome: WorkExecutionHostOutcome,
    submissionId: string,
  ): Promise<WorkExecutionCheckpoint> {
    const candidate = createWorkExecutionSubmission(submissionId, outcome);
    const result = await this.ctx.runStore.commitGuarded(intent.runId, ({ state, trajectory }) => {
      const current = state.workExecution;
      if (!current || current.intentId !== intent.intentId) {
        throw new Error('Work submission does not match the authoritative Run claim');
      }
      assertSameClaim(current, intent);
      const disposition = classifyWorkExecutionSubmission({
        ...(current.pendingSubmission ? { pending: current.pendingSubmission } : {}),
        rejected: current.rejectedSubmissions ?? [],
        ...(current.acceptedSubmission ? { accepted: current.acceptedSubmission } : {}),
        candidate,
      });
      if (disposition !== 'new') return { value: structuredClone(current) };
      if (!['invoking', 'unknown'].includes(current.status)) {
        throw new Error(`Work submission cannot be recorded from ${current.status}`);
      }
      const timestamp = new Date().toISOString();
      const checkpoint: WorkExecutionCheckpoint = {
        ...current,
        status: 'submitted',
        continuation: 'execute',
        pendingSubmission: candidate,
        updatedAt: timestamp,
      };
      const nextState: RunState = {
        ...state,
        workExecution: checkpoint,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type: 'work.host-completed',
          identity: [current.workId, String(current.attempt), submissionId],
          data: {
            workId: intent.workId,
            attempt: intent.attempt,
            checkEpoch: intent.checkEpoch,
            invocationId: outcome.invocationId,
            hostId: outcome.hostId,
            packetDigest: outcome.packetDigest,
            submissionId,
            submissionDigest: candidate.payloadDigest,
            result: outcome.status,
            findingCount: outcome.findings?.length ?? 0,
            ...(outcome.findings?.[0] ? { findingKind: outcome.findings[0].kind } : {}),
          },
        }),
        value: structuredClone(checkpoint),
      };
    });
    await this.recordEvent(
      intent.runId,
      intent.intentId,
      'work.outcome-submitted',
      {
        workId: intent.workId,
        attempt: intent.attempt,
        checkEpoch: intent.checkEpoch,
        submissionId,
        submissionDigest: candidate.payloadDigest,
        result: outcome.status,
      },
      [submissionId, candidate.payloadDigest],
    );
    if (
      result.pendingSubmission?.submissionId === submissionId &&
      (result.rejectedSubmissions?.length ?? 0) > 0
    ) {
      await this.recordEvent(
        intent.runId,
        intent.intentId,
        'work.outcome-corrected',
        {
          workId: intent.workId,
          attempt: intent.attempt,
          checkEpoch: intent.checkEpoch,
          submissionId,
          rejectedSubmissionCount: result.rejectedSubmissions?.length ?? 0,
        },
        [submissionId],
      );
    }
    return result;
  }

  async rejectHostSubmission(input: {
    intent: ActionIntent;
    reasonCode: WorkExecutionSubmissionRejectionCode;
    diagnostic: string;
  }): Promise<WorkExecutionCheckpoint> {
    const result = await this.ctx.runStore.commitGuarded(
      input.intent.runId,
      ({ state, trajectory }) => {
        const current = state.workExecution;
        if (!current || current.intentId !== input.intent.intentId) {
          throw new Error('Work rejection does not match the authoritative Run claim');
        }
        assertSameClaim(current, input.intent);
        if (!current.pendingSubmission) {
          if (
            current.status === 'invoking' &&
            (current.continuation === 'awaiting-correction' || current.continuation === 'wait')
          ) {
            return { value: structuredClone(current) };
          }
          throw new Error('Work rejection requires a pending Host submission');
        }
        if (current.status !== 'submitted') {
          throw new Error(`Work submission cannot be rejected from ${current.status}`);
        }
        const timestamp = new Date().toISOString();
        const submission = current.pendingSubmission;
        const processingError = input.reasonCode === 'outcome-processing-error';
        const rejectedSubmissions = processingError
          ? (current.rejectedSubmissions ?? [])
          : appendRejectedWorkExecutionSubmission(current.rejectedSubmissions ?? [], submission, {
              reasonCode: input.reasonCode,
              diagnostic: input.diagnostic,
              rejectedAt: timestamp,
            });
        const continuation = processingError ? 'execute' : 'awaiting-correction';
        const checkpoint: WorkExecutionCheckpoint = {
          ...current,
          status: processingError ? 'submitted' : 'invoking',
          continuation,
          pendingSubmission: processingError ? submission : null,
          rejectedSubmissions,
          updatedAt: timestamp,
        };
        const nextState: RunState = {
          ...state,
          workExecution: checkpoint,
          stateVersion: state.stateVersion + 1,
          updatedAt: timestamp,
        };
        return {
          state: nextState,
          event: executionEvent({
            state: nextState,
            sequence: trajectory.length + 1,
            timestamp,
            type:
              input.reasonCode === 'outcome-processing-error'
                ? 'work.outcome-processing-error'
                : 'work.outcome-rejected',
            identity: [current.workId, String(current.attempt), submission.submissionId],
            data: {
              workId: current.workId,
              attempt: current.attempt,
              checkEpoch: current.checkEpoch,
              submissionId: submission.submissionId,
              submissionDigest: submission.payloadDigest,
              reasonCode: input.reasonCode,
              diagnostic: input.diagnostic,
              continuation,
            },
          }),
          value: structuredClone(checkpoint),
        };
      },
    );
    return result;
  }

  async recoverLegacyRejectedOutcome(input: {
    intent: ActionIntent;
    diagnostic: string;
  }): Promise<WorkExecutionCheckpoint> {
    const result = await this.ctx.runStore.commitGuarded(
      input.intent.runId,
      ({ state, trajectory }) => {
        const current = state.workExecution;
        if (!current || current.intentId !== input.intent.intentId) {
          throw new Error('Legacy Work recovery does not match the authoritative Run claim');
        }
        assertSameClaim(current, input.intent);
        const existing = current.rejectedSubmissions?.find((submission) =>
          submission.submissionId.startsWith('legacy:'),
        );
        if (
          existing &&
          current.status === 'invoking' &&
          current.continuation === 'awaiting-correction'
        ) {
          return { value: structuredClone(current) };
        }
        const legacySubmissionId = `legacy:${rawDigest(
          input.intent.runId,
          input.intent.intentId,
          current.actionOutcome?.outcomeId ?? 'missing',
        )}`;
        if (
          current.status !== 'outcome' ||
          current.acceptedSubmission ||
          !current.hostOutcome ||
          !current.actionOutcome ||
          current.actionOutcome.status !== 'succeeded'
        ) {
          throw new Error('Legacy Work recovery requires an unaccepted terminal success Outcome');
        }
        const submission = createWorkExecutionSubmission(legacySubmissionId, current.hostOutcome);
        const timestamp = new Date().toISOString();
        const rejectedSubmissions = appendRejectedWorkExecutionSubmission(
          current.rejectedSubmissions ?? [],
          submission,
          {
            reasonCode: 'outcome-rejected',
            diagnostic: input.diagnostic,
            rejectedAt: timestamp,
          },
        );
        const {
          hostOutcome: _legacyHostOutcome,
          actionOutcome: _legacyActionOutcome,
          receiptId: _legacyReceiptId,
          validatorId: _legacyValidatorId,
          acceptedSubmission: _legacyAcceptedSubmission,
          pendingSubmission: _legacyPendingSubmission,
          ...preserved
        } = current;
        void _legacyHostOutcome;
        void _legacyActionOutcome;
        void _legacyReceiptId;
        void _legacyValidatorId;
        void _legacyAcceptedSubmission;
        void _legacyPendingSubmission;
        const checkpoint: WorkExecutionCheckpoint = {
          ...preserved,
          status: 'invoking',
          continuation: 'awaiting-correction',
          pendingSubmission: null,
          rejectedSubmissions,
          updatedAt: timestamp,
        };
        const nextState: RunState = {
          ...state,
          workExecution: checkpoint,
          stateVersion: state.stateVersion + 1,
          updatedAt: timestamp,
        };
        return {
          state: nextState,
          event: executionEvent({
            state: nextState,
            sequence: trajectory.length + 1,
            timestamp,
            type: 'work.outcome-rejected',
            identity: [current.workId, String(current.attempt), legacySubmissionId],
            data: {
              phase: state.changeLifecycle?.phase,
              workId: current.workId,
              workKind: state.changeLifecycle?.currentWork?.kind,
              attempt: current.attempt,
              checkEpoch: current.checkEpoch,
              submissionId: legacySubmissionId,
              submissionDigest: submission.payloadDigest,
              reasonCode: 'outcome-rejected',
              diagnostic: input.diagnostic,
              continuation: 'awaiting-correction',
              legacyRecovery: true,
            },
          }),
          value: structuredClone(checkpoint),
        };
      },
    );
    await this.flushTelemetry(input.intent.runId);
    return result;
  }

  async bindOutcome(input: {
    intent: ActionIntent;
    outcome: ClaimedActionOutcome;
    receipt: ActionReceipt;
  }): Promise<WorkExecutionCheckpoint> {
    const result = await this.ctx.runStore.commitGuarded(
      input.intent.runId,
      ({ state, trajectory }) => {
        const current = state.workExecution;
        if (!current || current.intentId !== input.intent.intentId) {
          throw new Error('Work acceptance does not match the authoritative Run claim');
        }
        assertSameClaim(current, input.intent);
        if (
          current.status === 'outcome' &&
          current.actionOutcome?.outcomeId === input.outcome.outcomeId
        ) {
          return { value: structuredClone(current) };
        }
        if (current.status !== 'submitted' || !current.pendingSubmission) {
          throw new Error('Work acceptance requires a validated pending Host submission');
        }
        const timestamp = new Date().toISOString();
        const acceptedSubmission = current.pendingSubmission;
        const checkpoint: WorkExecutionCheckpoint = {
          ...current,
          status: 'outcome',
          continuation: 'wait',
          pendingSubmission: null,
          acceptedSubmission,
          hostOutcome: structuredClone(acceptedSubmission.outcome),
          actionOutcome: structuredClone(input.outcome),
          receiptId: input.receipt.receiptId,
          updatedAt: timestamp,
        };
        const nextState: RunState = {
          ...state,
          workExecution: checkpoint,
          stateVersion: state.stateVersion + 1,
          updatedAt: timestamp,
        };
        return {
          state: nextState,
          event: executionEvent({
            state: nextState,
            sequence: trajectory.length + 1,
            timestamp,
            type: 'work.completed',
            identity: [current.workId, String(current.attempt), input.outcome.outcomeId],
            data: {
              workId: input.intent.workId,
              attempt: input.intent.attempt,
              outcomeId: input.outcome.outcomeId,
              receiptId: input.receipt.receiptId,
              submissionId: acceptedSubmission.submissionId,
              result: input.outcome.status,
            },
          }),
          value: structuredClone(checkpoint),
        };
      },
    );
    await this.recordEvent(
      input.intent.runId,
      input.intent.intentId,
      'work.outcome-accepted',
      {
        workId: input.intent.workId,
        attempt: input.intent.attempt,
        checkEpoch: input.intent.checkEpoch,
        submissionId: result.acceptedSubmission?.submissionId,
        result: input.outcome.status,
      },
      [input.outcome.outcomeId],
    );
    await this.flushTelemetry(input.intent.runId);
    return result;
  }

  async markValidated(input: {
    intent: ActionIntent;
    validatorId: string;
    continuation: WorkContinuationKind;
  }): Promise<WorkExecutionCheckpoint> {
    return this.transition(
      input.intent.runId,
      input.intent.intentId,
      ['outcome'],
      'validator.completed',
      'validated',
      input.continuation,
      {
        workId: input.intent.workId,
        attempt: input.intent.attempt,
        validatorId: input.validatorId,
        result: 'accepted',
        continuation: input.continuation,
      },
      { validatorId: input.validatorId },
    );
  }

  async loadIntent(runId: string): Promise<ActionIntent> {
    const state = await this.ctx.runStore.loadRun(runId);
    const claim = state.workExecution;
    if (!claim) throw new Error(`Run has no authoritative Work claim: ${runId}`);
    if (claim.schemaVersion !== 3) {
      throw new Error('Legacy Work execution checkpoint requires migration');
    }
    const intent = await this.ctx.actionStore.loadIntent(runId, claim.workId, claim.attempt);
    assertSameClaim(claim, intent);
    const expectedIdempotencyKey = rawDigest(
      intent.runId,
      intent.workId,
      String(intent.attempt),
      String(intent.checkEpoch),
      intent.inputDigest,
      intent.adapter,
    );
    if (
      intent.idempotencyKey !== expectedIdempotencyKey ||
      intent.intentId !== rawDigest('intent', expectedIdempotencyKey) ||
      intent.claimToken !== digest('claim', expectedIdempotencyKey)
    ) {
      throw new Error('Authoritative Action intent content is corrupt');
    }
    if (
      intent.compositionDigest !== intent.composition.compositionDigest ||
      intent.compositionDigest !== state.composition.compositionDigest ||
      intent.executionContext?.digest !== claim.packet.contextDigest
    ) {
      throw new Error('Authoritative Action intent content drifted from the Work packet');
    }
    return intent;
  }

  async loadAuthoritativePacket(runId: string): Promise<WorkClaimResult> {
    const state = await this.ctx.runStore.loadRun(runId);
    const checkpoint = state.workExecution;
    if (!checkpoint) throw new Error(`Run has no authoritative Work claim: ${runId}`);
    if (checkpoint.schemaVersion !== 3) {
      throw new Error('Legacy Work execution checkpoint requires migration');
    }
    const intent = await this.loadIntent(runId);
    const packet = await this.ctx.workExecutionPacketStore.load(runId, checkpoint.packet);
    assertActivePacket(state, packet);
    assertSameClaim(checkpoint, intent);
    if (
      packet.claim.intentId !== intent.intentId ||
      packet.claim.runId !== intent.runId ||
      packet.claim.workId !== intent.workId ||
      packet.claim.attempt !== intent.attempt ||
      packet.claim.checkEpoch !== intent.checkEpoch ||
      packet.claim.claimToken !== intent.claimToken ||
      packet.claim.inputDigest !== intent.inputDigest ||
      packet.claim.compositionDigest !== intent.compositionDigest
    ) {
      throw new Error(
        'Stored Work execution packet does not match the authoritative Action intent',
      );
    }
    return { intent, packet };
  }

  async continuation(runId: string): Promise<WorkContinuationKind> {
    const state = await this.ctx.runStore.loadRun(runId);
    if (state.status === 'completed') return 'done';
    if (state.changeLifecycle?.waitCondition?.kind === 'human-decision') return 'ask';
    if (!state.workExecution) return state.changeLifecycle?.currentWork ? 'execute' : 'wait';
    if (state.workExecution.status === 'outcome') return 'execute';
    return state.workExecution.continuation;
  }

  async recovery(runId: string): Promise<WorkExecutionRecovery> {
    const state = await this.ctx.runStore.loadRun(runId);
    const current = state.workExecution;
    const result = (
      continuation: WorkContinuationKind,
      reason: WorkExecutionRecovery['reason'],
    ): WorkExecutionRecovery => ({
      schemaVersion: 2,
      continuation,
      workId: current?.workId ?? state.changeLifecycle?.currentWork?.workId ?? null,
      attempt: current?.attempt ?? null,
      checkEpoch: current?.checkEpoch ?? state.changeLifecycle?.checkEpoch ?? null,
      reason,
    });
    if (state.status === 'completed') return result('done', 'terminal');
    if (state.changeLifecycle?.waitCondition?.kind === 'human-decision') {
      return result('ask', 'human-decision');
    }
    if (!current) {
      return state.changeLifecycle?.currentWork
        ? result('execute', 'work-unclaimed')
        : result('wait', 'transition-pending');
    }
    if (current.schemaVersion !== 3) {
      try {
        await this.recordPacketRecovery(runId, 'legacy');
      } catch {
        // Recovery classification remains authoritative when observation is unavailable.
      }
      return result('reconcile', 'migration-required');
    }
    try {
      await this.loadAuthoritativePacket(runId);
    } catch (error) {
      try {
        await this.recordPacketRecoveryFailure(runId, error);
      } catch {
        // Recovery classification remains authoritative when observation is unavailable.
      }
      return result('reconcile', 'content-missing-or-corrupt');
    }
    try {
      await this.recordPacketRecovery(runId, 'recovered');
    } catch {
      // Recovery classification remains authoritative when observation is unavailable.
    }
    if (current.status === 'claimed' || current.status === 'context-delivered') {
      return result('execute', 'claim-redelivery');
    }
    if (current.status === 'submitted') {
      return current.continuation === 'execute'
        ? result('execute', 'validator-pending')
        : result('execute', 'outcome-processing-error');
    }
    if (current.status === 'invoking') {
      if (current.continuation === 'awaiting-correction') {
        return result('awaiting-correction', 'outcome-rejected');
      }
      return current.hostInvocation &&
        this.ctx.workExecutionSessions.isActive(current.hostInvocation.invocationId)
        ? result('wait', 'host-active')
        : result('reconcile', 'host-result-unknown');
    }
    if (current.status === 'unknown') return result('reconcile', 'host-result-unknown');
    if (current.status === 'not-executed') return result('execute', 'host-not-executed');
    if (current.status === 'outcome') {
      return current.actionOutcome?.status === 'failed'
        ? result('execute', 'work-failed')
        : result('execute', 'validator-pending');
    }
    return result('execute', 'transition-pending');
  }

  async recordContinuation(runId: string, recovery: WorkExecutionRecovery): Promise<void> {
    await this.ctx.runStore.commitGuarded(runId, ({ state, trajectory }) => {
      const eventId = digest(
        runId,
        'continuation.selected',
        recovery.workId ?? 'none',
        String(recovery.attempt ?? 0),
        recovery.continuation,
        recovery.reason,
      );
      if (trajectory.some((event) => event.eventId === eventId)) return { value: undefined };
      const timestamp = new Date().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type: 'continuation.selected',
          identity: [
            recovery.workId ?? 'none',
            String(recovery.attempt ?? 0),
            recovery.continuation,
            recovery.reason,
          ],
          data: {
            continuation: recovery.continuation,
            reason: recovery.reason,
            workId: recovery.workId,
            attempt: recovery.attempt,
          },
        }),
        value: undefined,
      };
    });
    await this.flushTelemetry(runId);
  }

  async recordWaitBoundary(input: {
    runId: string;
    waitId: string;
    stage: 'started' | 'ended';
    kind: string;
    reason: string;
  }): Promise<void> {
    await this.ctx.runStore.commitGuarded(input.runId, ({ state, trajectory }) => {
      const type = `wait.${input.stage}` as const;
      const eventId = digest(input.runId, type, input.waitId, input.stage);
      if (trajectory.some((event) => event.eventId === eventId)) return { value: undefined };
      const timestamp = new Date().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type,
          identity: [input.waitId, input.stage],
          data: { waitId: input.waitId, waitKind: input.kind, reason: input.reason },
        }),
        value: undefined,
      };
    });
    await this.flushTelemetry(input.runId);
  }

  async saveCoordination(input: {
    runId: string;
    currentTask?: string | null;
    observedPaths?: readonly string[];
    progress?: readonly string[];
  }): Promise<AgentCoordinationCheckpoint> {
    const state = await this.ctx.runStore.loadRun(input.runId);
    const execution = state.workExecution;
    if (!execution) throw new Error('Coordination checkpoint requires an authoritative Work claim');
    const bounded = (values: readonly string[] | undefined, label: string): string[] => {
      const result = [...new Set(values ?? [])].map((value) => value.trim()).filter(Boolean);
      if (result.length > 64 || result.some((value) => value.length > 256)) {
        throw new Error(`${label} exceeds the coordination checkpoint bound`);
      }
      return result.sort();
    };
    const checkpoint: AgentCoordinationCheckpoint = {
      schemaVersion: 2,
      runId: state.runId,
      workId: execution.workId,
      attempt: execution.attempt,
      checkEpoch: execution.checkEpoch,
      observedStateVersion: state.stateVersion,
      currentTask: input.currentTask?.trim() || null,
      observedPaths: bounded(input.observedPaths, 'Observed paths'),
      progress: bounded(input.progress, 'Progress'),
      updatedAt: new Date().toISOString(),
    };
    await this.ctx.runStore.writeCoordinationCheckpoint(checkpoint);
    return checkpoint;
  }

  async coordination(runId: string): Promise<AgentCoordinationCheckpointView> {
    const [state, checkpoint] = await Promise.all([
      this.ctx.runStore.loadRun(runId),
      this.ctx.runStore.readCoordinationCheckpoint(runId),
    ]);
    if (!checkpoint) return { status: 'missing', checkpoint: null };
    const execution = state.workExecution;
    const current =
      execution !== undefined &&
      state.changeLifecycle?.checkEpoch === checkpoint.checkEpoch &&
      checkpoint.workId === execution.workId &&
      checkpoint.attempt === execution.attempt &&
      checkpoint.observedStateVersion <= state.stateVersion;
    return { status: current ? 'current' : 'stale', checkpoint };
  }

  private async transition(
    runId: string,
    intentId: string,
    allowed: readonly WorkExecutionCheckpoint['status'][],
    type: TrajectoryEventType,
    status: WorkExecutionCheckpoint['status'],
    continuation: WorkContinuationKind,
    data: Record<string, unknown>,
    additions: Partial<WorkExecutionCheckpoint> = {},
  ): Promise<WorkExecutionCheckpoint> {
    const result = await this.ctx.runStore.commitGuarded(runId, ({ state, trajectory }) => {
      const current = state.workExecution;
      if (!current || current.intentId !== intentId) {
        throw new Error('Work execution transition does not match the authoritative Run claim');
      }
      if (
        state.changeLifecycle &&
        (state.changeLifecycle.checkEpoch !== current.checkEpoch ||
          state.changeLifecycle.currentWork?.workId !== current.workId)
      ) {
        throw new Error('Stale Work execution cannot cross a lifecycle checkEpoch boundary');
      }
      if (!allowed.includes(current.status)) {
        if (current.status === status) return { value: structuredClone(current) };
        throw new Error(`Work execution cannot move from ${current.status} to ${status}`);
      }
      const timestamp = new Date().toISOString();
      const checkpoint: WorkExecutionCheckpoint = {
        ...current,
        ...structuredClone(additions),
        status,
        continuation,
        updatedAt: timestamp,
      };
      const nextState: RunState = {
        ...state,
        workExecution: checkpoint,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type,
          identity: [current.workId, String(current.attempt), intentId, status],
          data,
        }),
        value: structuredClone(checkpoint),
      };
    });
    await this.flushTelemetry(runId);
    return result;
  }

  private async recordEvent(
    runId: string,
    intentId: string,
    type: TrajectoryEventType,
    data: Record<string, unknown>,
    identity: readonly string[],
  ): Promise<void> {
    await this.ctx.runStore.commitGuarded(runId, ({ state, trajectory }) => {
      const current = state.workExecution;
      if (!current || current.intentId !== intentId) {
        throw new Error('Execution event does not match the authoritative Run claim');
      }
      if (
        state.changeLifecycle &&
        (state.changeLifecycle.checkEpoch !== current.checkEpoch ||
          state.changeLifecycle.currentWork?.workId !== current.workId)
      ) {
        throw new Error('Stale Work event cannot cross a lifecycle checkEpoch boundary');
      }
      const eventId = digest(runId, type, current.workId, String(current.attempt), ...identity);
      if (trajectory.some((event) => event.eventId === eventId)) {
        return { value: undefined };
      }
      const timestamp = new Date().toISOString();
      const nextState: RunState = {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: timestamp,
      };
      return {
        state: nextState,
        event: executionEvent({
          state: nextState,
          sequence: trajectory.length + 1,
          timestamp,
          type,
          identity: [current.workId, String(current.attempt), ...identity],
          data,
        }),
        value: undefined,
      };
    });
    await this.flushTelemetry(runId);
  }

  private async flushTelemetry(runId: string): Promise<void> {
    try {
      const [run, workflow, projectSnapshot, trajectory, cursor] = await Promise.all([
        this.ctx.runStore.loadRun(runId),
        this.ctx.runStore.loadWorkflow(runId),
        this.ctx.runStore.loadProjectSnapshot(runId),
        this.ctx.runStore.loadTrajectory(runId),
        this.ctx.runStore.readTelemetryCursor(runId),
      ]);
      const events = trajectory.slice(cursor.trajectoryOffset);
      if (events.length === 0) return;
      await this.ctx.workflowTelemetry.export({
        run,
        workflow,
        projectSnapshot,
        events,
        trajectory,
      });
      await this.ctx.runStore.writeTelemetryCursor({
        schemaVersion: 1,
        runId,
        trajectoryOffset: trajectory.length,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Execution authority is durable before export. The persisted cursor/outbox
      // intentionally retries later and telemetry may never change Work results.
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workExecutionAuthority: WorkExecutionAuthority;
  }
}
