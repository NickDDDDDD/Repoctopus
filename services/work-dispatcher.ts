import { randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { ActionAdapter } from '../domains/action/ports.js';
import type {
  ActionIntent,
  ClaimedActionOutcome,
  WorkClaimRequest,
  WorkOutcomeAcceptance,
} from '../domains/action/types.js';
import {
  createWorkExecutionPacket,
  type WorkClaimResult,
} from '../domains/work-execution/types.js';
import type {
  ChangeLifecycleState,
  WorkDescriptor,
} from '../domains/change-lifecycle/transition.js';
import {
  lifecycleContributorSnapshot,
  type LifecycleContributorIdentity,
} from '../domains/change-lifecycle/contributors.js';

export interface WorkContributor {
  id: string;
  identity: LifecycleContributorIdentity & { kind: 'work' };
  requiredCapabilities: readonly string[];
}

function assertContributorSupportsWork(contributor: WorkContributor, work: WorkDescriptor): void {
  const missing = contributor.requiredCapabilities.filter(
    (capability) => !work.capabilities.includes(capability),
  );
  if (missing.length > 0) {
    throw new Error(
      `Work Contributor ${contributor.id} cannot claim ${work.workId}; missing ${missing.join(', ')}`,
    );
  }
}

export function assertHostSupportsWork(
  hostCapabilities: readonly string[],
  work: WorkDescriptor,
): void {
  const missing = missingHostCapabilities(hostCapabilities, work);
  if (missing.length > 0) {
    throw new Error(
      `External Work Execution Host cannot claim ${work.workId}; missing ${missing.join(', ')}`,
    );
  }
}

export function missingHostCapabilities(
  hostCapabilities: readonly string[],
  work: WorkDescriptor,
): readonly string[] {
  const available = new Set(
    hostCapabilities.map((capability) => capability.trim()).filter(Boolean),
  );
  return work.capabilities.filter((capability) => !available.has(capability));
}

function createChangeInputs(input: {
  runId: string;
  lifecycle: ChangeLifecycleState;
  work: WorkDescriptor;
}): unknown {
  const protocol = input.lifecycle.buildProtocol;
  const plan = protocol?.plan ?? null;
  return {
    runId: input.runId,
    change: input.lifecycle.identity,
    taskId: input.work.taskId ?? null,
    taskRevision: input.work.taskRevision ?? null,
    inputDigest: input.work.inputDigest,
    tasks: input.lifecycle.tasks ?? [],
    workspaceIntent: input.lifecycle.workspaceIntent ?? null,
    build: protocol
      ? {
          currentAction: protocol.currentAction,
          actionAttempt: protocol.actionAttempt,
          strategy: protocol.strategy,
          binding: protocol.binding,
          plan,
          planEvidence: protocol.planEvidence,
          packageCompletions: protocol.packageCompletions,
          currentPackage:
            plan?.packages.find((candidate) => candidate.packageId === input.work.packageId) ??
            null,
        }
      : null,
    archiveDeliveryInput: input.lifecycle.archiveDeliveryInput ?? null,
  };
}

export function outcomeReceiptAdapter(id: string): ActionAdapter {
  return {
    id,
    complete(intent, input) {
      return Promise.resolve({
        schemaVersion: 3,
        receiptId: input.receiptId,
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        runId: intent.runId,
        workId: intent.workId,
        attempt: intent.attempt,
        checkEpoch: intent.checkEpoch,
        claimToken: intent.claimToken,
        inputDigest: intent.inputDigest,
        outcomeId: input.outcomeId,
        compositionDigest: input.compositionDigest,
        actionId: intent.action.id,
        adapter: id,
        ...(intent.executor ? { executor: structuredClone(intent.executor) } : {}),
        outcome: input.status,
        summary: input.summary,
        completedAt: new Date().toISOString(),
      });
    },
  };
}

export class WorkDispatcher extends Service {
  static inject = [
    'actionDispatcher',
    'actionStore',
    'runStore',
    'workContextAssembler',
    'workExecutionAuthority',
  ];

  private readonly contributors = new Map<string, WorkContributor>();

  constructor(context: Context) {
    super(context, 'workDispatcher');
  }

  register(contributor: WorkContributor): () => void {
    const id = contributor.id.trim();
    if (!id) throw new Error('Work Contributor id is required');
    if (this.contributors.has(id)) throw new Error(`Work Contributor already registered: ${id}`);
    const normalized = {
      id,
      identity: structuredClone(contributor.identity),
      requiredCapabilities: [...new Set(contributor.requiredCapabilities)].sort(),
    };
    this.contributors.set(id, normalized);
    return () => {
      if (this.contributors.get(id) === normalized) this.contributors.delete(id);
    };
  }

  list(): string[] {
    return [...this.contributors.keys()].sort((left, right) => left.localeCompare(right));
  }

  snapshot() {
    return lifecycleContributorSnapshot(
      [...this.contributors.values()].map((entry) => entry.identity),
    );
  }

  async claim(request: WorkClaimRequest): Promise<WorkClaimResult> {
    const state = await this.ctx.runStore.loadRun(request.runId);
    const work = state.changeLifecycle?.currentWork;
    if (state.status !== 'running' || !work) {
      throw new Error(`Run has no active lifecycle Work: ${request.runId}`);
    }
    const contributor = this.contributors.get(request.adapter);
    if (!contributor) throw new Error(`Work Contributor is not active: ${request.adapter}`);
    if (
      !request.executor.authenticated ||
      !request.executor.actorId.trim() ||
      !request.executor.runnerId.trim()
    ) {
      throw new Error('Work claim requires an authenticated actor and Runner identity');
    }
    assertContributorSupportsWork(contributor, work);
    if (request.hostCapabilities !== undefined) {
      const missing = missingHostCapabilities(request.hostCapabilities, work);
      if (missing.length > 0) {
        try {
          await this.ctx.workExecutionAuthority.recordClaimRejected({
            runId: request.runId,
            work,
            attempt: request.attempt ?? 1,
            reasonCode: 'capability-required',
            missingCapabilityCount: missing.length,
          });
        } catch {
          // Observability must not turn a rejected claim into an accepted claim.
        }
        assertHostSupportsWork(request.hostCapabilities, work);
      }
    }
    const executionContext = await this.ctx.workContextAssembler.assemble({
      work,
      changeId: state.changeLifecycle!.identity.changeId,
      changeInputs: createChangeInputs({
        runId: state.runId,
        lifecycle: state.changeLifecycle!,
        work,
      }),
      diagnostic: work.phase === 'build' && (request.attempt ?? 1) > 1,
    });
    const intent = await this.ctx.actionDispatcher.claim({
      runId: request.runId,
      workId: work.workId,
      attempt: request.attempt ?? 1,
      checkEpoch: work.checkEpoch,
      inputDigest: work.inputDigest,
      composition: state.composition,
      action: {
        id: work.workId,
        stepId: `${work.phase}:${work.kind}`,
        type: work.actionSkill ? 'invoke_skill' : 'call_tool',
        ref: work.actionSkill?.name ?? work.kind,
        summary: `Execute ${work.kind}`,
      },
      adapter: contributor.id,
      executor: structuredClone(request.executor),
      executionContext: {
        digest: executionContext.digest,
        layers: executionContext.layers.map((entry) => ({
          kind: entry.kind,
          priority: entry.priority,
          source: entry.source,
          digest: entry.digest,
        })),
      },
    });
    const packet = createWorkExecutionPacket({ intent, work, context: executionContext });
    await this.ctx.workExecutionAuthority.bindClaim(packet);
    await this.ctx.workExecutionAuthority.recordSkillFacts(packet, 'resolved');
    await this.ctx.workExecutionAuthority.markContextDelivered(packet);
    await this.ctx.workExecutionAuthority.recordSkillFacts(packet, 'delivered');
    return { intent, packet };
  }

  async resumeClaim(runId: string): Promise<WorkClaimResult> {
    try {
      const result = await this.ctx.workExecutionAuthority.loadAuthoritativePacket(runId);
      try {
        await this.ctx.workExecutionAuthority.recordPacketRecovery(runId, 'recovered');
      } catch {
        // Packet recovery succeeded; an observation failure must not trigger re-execution.
      }
      return result;
    } catch (error) {
      try {
        await this.ctx.workExecutionAuthority.recordPacketRecoveryFailure(runId, error);
      } catch {
        // Preserve the original packet failure and its continuation classification.
      }
      throw error;
    }
  }

  async acceptOutcome(input: ClaimedActionOutcome): Promise<WorkOutcomeAcceptance> {
    const state = await this.ctx.runStore.loadRun(input.runId);
    const work = state.changeLifecycle?.currentWork;
    if (
      state.status !== 'running' ||
      !work ||
      work.workId !== input.workId ||
      work.inputDigest !== input.inputDigest
    ) {
      throw new Error('Work Outcome does not belong to the active lifecycle Work');
    }
    const intent = await this.ctx.workExecutionAuthority.loadIntent(input.runId);
    if (!this.contributors.has(intent.adapter)) {
      throw new Error(`Work Contributor is no longer active: ${intent.adapter}`);
    }
    const receipt = await this.ctx.actionDispatcher.complete(input);
    await this.ctx.workExecutionAuthority.bindOutcome({ intent, outcome: input, receipt });
    return {
      intent,
      outcome: structuredClone(input),
      receipt,
      validation: 'pending',
      lifecycleAdvanced: false,
    };
  }

  outcome(
    intent: ActionIntent,
    status: 'succeeded' | 'failed',
    summary: string,
  ): ClaimedActionOutcome {
    return {
      schemaVersion: 2,
      outcomeId: randomUUID(),
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
      checkEpoch: intent.checkEpoch,
      claimToken: intent.claimToken,
      inputDigest: intent.inputDigest,
      status,
      summary,
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workDispatcher: WorkDispatcher;
  }
}
