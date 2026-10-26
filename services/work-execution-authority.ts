import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { ActionIntent, ActionReceipt, ClaimedActionOutcome } from '../domains/action/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { TrajectoryEvent, TrajectoryEventType } from '../domains/trajectory/types.js';
import type {
  AgentCoordinationCheckpoint,
  AgentCoordinationCheckpointView,
  WorkContinuationKind,
  WorkExecutionCheckpoint,
  WorkExecutionHostInvocation,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
  WorkExecutionRecovery,
} from '../domains/work-execution/types.js';

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

export class WorkExecutionAuthority extends Service {
  static inject = ['runStore', 'actionStore', 'workExecutionSessions', 'workflowTelemetry'];

  constructor(context: Context) {
    super(context, 'workExecutionAuthority');
  }

  async bindClaim(packet: WorkExecutionPacket): Promise<WorkExecutionCheckpoint> {
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
          schemaVersion: 2,
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
            },
          }),
          value: structuredClone(checkpoint),
        };
      },
    );
    await this.flushTelemetry(packet.claim.runId);
    return result;
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
      ['invoking'],
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
  ): Promise<WorkExecutionCheckpoint> {
    return this.transition(
      intent.runId,
      intent.intentId,
      ['invoking', 'unknown'],
      'work.host-completed',
      'invoking',
      'wait',
      {
        workId: intent.workId,
        attempt: intent.attempt,
        checkEpoch: intent.checkEpoch,
        invocationId: outcome.invocationId,
        hostId: outcome.hostId,
        packetDigest: outcome.packetDigest,
        result: outcome.status,
        findingCount: outcome.findings?.length ?? 0,
        ...(outcome.findings?.[0] ? { findingKind: outcome.findings[0].kind } : {}),
      },
      { hostOutcome: structuredClone(outcome) },
    );
  }

  async bindOutcome(input: {
    intent: ActionIntent;
    outcome: ClaimedActionOutcome;
    receipt: ActionReceipt;
  }): Promise<WorkExecutionCheckpoint> {
    return this.transition(
      input.intent.runId,
      input.intent.intentId,
      ['context-delivered', 'invoking'],
      'work.completed',
      'outcome',
      'wait',
      {
        workId: input.intent.workId,
        attempt: input.intent.attempt,
        outcomeId: input.outcome.outcomeId,
        receiptId: input.receipt.receiptId,
        result: input.outcome.status,
      },
      {
        actionOutcome: structuredClone(input.outcome),
        receiptId: input.receipt.receiptId,
      },
    );
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
    try {
      await this.loadIntent(runId);
    } catch {
      return result('reconcile', 'content-missing-or-corrupt');
    }
    if (current.status === 'claimed' || current.status === 'context-delivered') {
      return result('execute', 'claim-redelivery');
    }
    if (current.status === 'invoking') {
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
      const eventId = digest(input.runId, type, input.waitId);
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
