import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { WorkClaimRequest, WorkOutcomeAcceptance } from '../domains/action/types.js';
import type {
  WorkExecutionHostInvocation,
  WorkExecutionHostOutcome,
} from '../domains/work-execution/types.js';

function invocationId(packetDigest: string, hostId: string): string {
  return `sha256:${createHash('sha256')
    .update(`work-host-invocation\0${packetDigest}\0${hostId}`)
    .digest('hex')}`;
}

export interface ManagedWorkExecutionResult {
  invocation: WorkExecutionHostInvocation;
  hostOutcome: WorkExecutionHostOutcome;
  acceptance: WorkOutcomeAcceptance | null;
}

export class ManagedWorkExecutor extends Service {
  static inject = [
    'workDispatcher',
    'workExecutionAuthority',
    'workExecutionHosts',
    'workExecutionSessions',
  ];

  constructor(context: Context) {
    super(context, 'managedWorkExecutor');
  }

  async execute(request: WorkClaimRequest): Promise<ManagedWorkExecutionResult> {
    const claim = await this.ctx.workDispatcher.claim(request);
    const host = this.ctx.workExecutionHosts.select(claim.packet);
    const preflight = await host.preflight(claim.packet);
    if (!preflight.accepted) {
      throw new Error(
        `Work Execution Host ${host.identity.id} rejected preflight: ${preflight.reason ?? 'unspecified'}`,
      );
    }
    const startedAt = new Date().toISOString();
    const invocation: WorkExecutionHostInvocation = {
      schemaVersion: 1,
      invocationId: invocationId(claim.packet.identity.packetDigest, host.identity.id),
      host: structuredClone(host.identity),
      packet: structuredClone(claim.packet.identity),
      startedAt,
    };
    await this.ctx.workExecutionAuthority.markHostStarted(claim.intent, invocation);
    const session = this.ctx.workExecutionSessions.open({
      runId: claim.intent.runId,
      workId: claim.intent.workId,
      attempt: claim.intent.attempt,
      invocationId: invocation.invocationId,
      packetDigest: claim.packet.identity.packetDigest,
      hostId: host.identity.id,
    });
    let hostOutcome: WorkExecutionHostOutcome;
    try {
      hostOutcome = await host.invoke(claim.packet, session);
    } catch (error) {
      await this.ctx.workExecutionAuthority.markHostUnknown(
        claim.intent,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      this.ctx.workExecutionSessions.close(session.sessionId);
    }
    if (
      hostOutcome.invocationId !== invocation.invocationId ||
      hostOutcome.hostId !== host.identity.id ||
      hostOutcome.packetDigest !== claim.packet.identity.packetDigest
    ) {
      await this.ctx.workExecutionAuthority.markHostUnknown(
        claim.intent,
        'Host returned an Outcome for another invocation',
      );
      throw new Error('Work Execution Host Outcome identity mismatch');
    }
    await this.ctx.workExecutionAuthority.markHostCompleted(claim.intent, hostOutcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      claim.packet,
      'consumed',
      hostOutcome.consumedLayerDigests,
    );
    if (hostOutcome.status === 'unknown') {
      await this.ctx.workExecutionAuthority.markHostUnknown(claim.intent, hostOutcome.summary);
      return { invocation, hostOutcome, acceptance: null };
    }
    const acceptance = await this.ctx.workDispatcher.acceptOutcome(
      this.ctx.workDispatcher.outcome(
        claim.intent,
        hostOutcome.status === 'succeeded' ? 'succeeded' : 'failed',
        hostOutcome.summary,
      ),
    );
    return { invocation, hostOutcome, acceptance };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    managedWorkExecutor: ManagedWorkExecutor;
  }
}
