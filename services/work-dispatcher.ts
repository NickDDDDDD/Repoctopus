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
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
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

export function outcomeReceiptAdapter(id: string): ActionAdapter {
  return {
    id,
    complete(intent, input) {
      return Promise.resolve({
        schemaVersion: 2,
        receiptId: input.receiptId,
        intentId: intent.intentId,
        idempotencyKey: intent.idempotencyKey,
        runId: intent.runId,
        workId: intent.workId,
        attempt: intent.attempt,
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
    const executionContext = await this.ctx.workContextAssembler.assemble({
      work,
      changeId: state.changeLifecycle!.identity.changeId,
      changeInputs: {
        runId: state.runId,
        change: state.changeLifecycle!.identity,
        taskId: work.taskId ?? null,
        taskRevision: work.taskRevision ?? null,
        inputDigest: work.inputDigest,
        archiveDeliveryInput: state.changeLifecycle!.archiveDeliveryInput ?? null,
      },
      diagnostic: work.phase === 'build' && (request.attempt ?? 1) > 1,
    });
    const intent = await this.ctx.actionDispatcher.claim({
      runId: request.runId,
      workId: work.workId,
      attempt: request.attempt ?? 1,
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
      schemaVersion: 1,
      outcomeId: randomUUID(),
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
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
