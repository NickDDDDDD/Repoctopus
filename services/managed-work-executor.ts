import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  WorkClaimRequest,
  WorkExecutorIdentity,
  WorkOutcomeAcceptance,
} from '../domains/action/types.js';
import type {
  ExternalWorkExecutionOutcome,
  WorkExecutionHostInvocation,
  WorkExecutionHostIdentity,
  WorkExecutionHostOutcome,
  WorkClaimResult,
  WorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { assertManagedDelegation } from '../domains/work-execution/delegation.js';
import { assertBoundedWorkExecutionFindings } from '../domains/work-execution/findings.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';

function assertBoundedExecutionResult(outcome: WorkExecutionHostOutcome): void {
  if (outcome.result && canonicalJson(outcome.result).length > 1024 * 1024) {
    throw new Error('Work Execution result exceeds the bounded payload size');
  }
  if (outcome.result?.kind === 'build-plan-candidate' && outcome.result.packages.length > 256) {
    throw new Error('Build Plan candidate exceeds the package bound');
  }
  const receipts = outcome.delegationReceipts ?? [];
  if (
    receipts.length > 64 ||
    new Set(receipts.map((receipt) => receipt.receiptId)).size !== receipts.length
  ) {
    throw new Error('Delegation receipts are duplicated or exceed the bounded receipt count');
  }
  for (const receipt of receipts) {
    if (
      receipt.schemaVersion !== 1 ||
      receipt.parentInvocationId !== outcome.invocationId ||
      receipt.coordinatorHostId !== outcome.hostId ||
      !receipt.executionId.trim() ||
      !receipt.packageId.trim() ||
      !['implementer', 'reviewer'].includes(receipt.role) ||
      !['succeeded', 'failed', 'unknown'].includes(receipt.status) ||
      !/^sha256:[a-f0-9]{64}$/u.test(receipt.outcomeDigest)
    ) {
      throw new Error('Delegation receipt does not match the parent Host invocation');
    }
  }
  if (!outcome.result) return;
  const common = ['schemaVersion', 'kind'];
  const allowed =
    outcome.result.kind === 'build-configuration-candidate'
      ? [...common, 'executionMode', 'tddMode']
      : outcome.result.kind === 'build-plan-candidate'
        ? [...common, 'packages']
        : outcome.result.kind === 'build-package-completion'
          ? [
              ...common,
              'packageId',
              'acceptanceEvidenceIds',
              'testEvidenceIds',
              'tddEvidence',
              'repositoryDigest',
              'implementationDigest',
            ]
          : outcome.result.kind === 'build-check-candidate'
            ? [
                ...common,
                'completedPackageIds',
                'acceptedTaskIds',
                'testEvidenceIds',
                'repositoryDigest',
                'implementationDigest',
                'reviewerExecutionId',
              ]
            : [];
  if (
    outcome.result.schemaVersion !== 1 ||
    allowed.length === 0 ||
    Object.keys(outcome.result).some((key) => !allowed.includes(key))
  ) {
    throw new Error('Work Execution result does not match the managed Build result schema');
  }
}

function invocationId(packetDigest: string, hostId: string): string {
  return `sha256:${createHash('sha256')
    .update(`work-host-invocation\0${packetDigest}\0${hostId}`)
    .digest('hex')}`;
}

function sameHostOutcome(left: WorkExecutionHostOutcome, right: WorkExecutionHostOutcome): boolean {
  const leftStable: Record<string, unknown> = { ...left };
  const rightStable: Record<string, unknown> = { ...right };
  delete leftStable.completedAt;
  delete rightStable.completedAt;
  return canonicalJson(leftStable) === canonicalJson(rightStable);
}

interface SkillConsumptionValidationFailure {
  reasonCode: 'missing-layer' | 'unknown-layer' | 'layer-set-mismatch';
  missingLayerDigests: readonly `sha256:${string}`[];
  unknownLayerDigests: readonly `sha256:${string}`[];
}

function validateConsumedExecutionSkills(
  packet: WorkExecutionPacket,
  outcome: Pick<WorkExecutionHostOutcome, 'status' | 'consumedLayerDigests'>,
): SkillConsumptionValidationFailure | null {
  if (outcome.status !== 'succeeded') return null;
  const required = packet.context.layers
    .filter((layer) => layer.kind === 'action-skill' || layer.kind === 'augmentation-skill')
    .map((layer) => layer.digest);
  const eligible = new Set(required);
  const consumed = new Set(outcome.consumedLayerDigests);
  const missingLayerDigests = required.filter((layerDigest) => !consumed.has(layerDigest));
  const unknownLayerDigests = [...consumed].filter((layerDigest) => !eligible.has(layerDigest));
  if (missingLayerDigests.length === 0 && unknownLayerDigests.length === 0) return null;
  return {
    reasonCode:
      missingLayerDigests.length > 0 && unknownLayerDigests.length > 0
        ? 'layer-set-mismatch'
        : missingLayerDigests.length > 0
          ? 'missing-layer'
          : 'unknown-layer',
    missingLayerDigests,
    unknownLayerDigests,
  };
}

export interface ManagedWorkExecutionResult {
  invocation: WorkExecutionHostInvocation;
  hostOutcome: WorkExecutionHostOutcome;
  acceptance: WorkOutcomeAcceptance | null;
}

export interface ExternalWorkClaimResult extends WorkClaimResult {
  invocation: WorkExecutionHostInvocation;
}

export class ManagedWorkExecutor extends Service {
  static inject = [
    'workDispatcher',
    'workExecutionAuthority',
    'workExecutionHosts',
    'workExecutionSessions',
    'runStore',
  ];

  constructor(context: Context) {
    super(context, 'managedWorkExecutor');
  }

  private async assertConsumedExecutionSkills(
    packet: WorkExecutionPacket,
    outcome: Pick<WorkExecutionHostOutcome, 'status' | 'consumedLayerDigests' | 'invocationId'>,
  ): Promise<void> {
    const failure = validateConsumedExecutionSkills(packet, outcome);
    if (!failure) return;
    await this.ctx.workExecutionAuthority.recordSkillConsumptionRejected(packet, {
      ...failure,
      invocationId: outcome.invocationId,
    });
    throw new Error(
      'Successful Work Execution Host Outcome must prove consumption of every delivered action and augmentation Skill layer',
    );
  }

  private async rejectInvalidConfigureResult(input: {
    intent: WorkClaimResult['intent'];
    workKind: WorkClaimResult['packet']['work']['kind'];
    outcome: WorkExecutionHostOutcome;
  }): Promise<boolean> {
    if (
      input.workKind !== 'build.configure' ||
      input.outcome.status !== 'succeeded' ||
      input.outcome.result?.kind === 'build-configuration-candidate'
    ) {
      return false;
    }
    await this.ctx.workExecutionAuthority.rejectHostSubmission({
      intent: input.intent,
      reasonCode: 'output-invalid',
      diagnostic: 'Build Configure Host must return a structured build-configuration-candidate',
    });
    return true;
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
      checkEpoch: claim.intent.checkEpoch,
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
    assertBoundedWorkExecutionFindings(hostOutcome);
    assertBoundedExecutionResult(hostOutcome);
    assertManagedDelegation(claim.packet, host.identity, hostOutcome);
    await this.assertConsumedExecutionSkills(claim.packet, hostOutcome);
    const submission = await this.ctx.workExecutionAuthority.markHostCompleted(
      claim.intent,
      hostOutcome,
      randomUUID(),
    );
    await this.ctx.workExecutionAuthority.recordDelegationFacts(claim.packet, hostOutcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      claim.packet,
      'consumed',
      hostOutcome.consumedLayerDigests,
    );
    if (
      await this.rejectInvalidConfigureResult({
        intent: claim.intent,
        workKind: claim.packet.work.kind,
        outcome: hostOutcome,
      })
    ) {
      return { invocation, hostOutcome, acceptance: null };
    }
    if (hostOutcome.status === 'unknown') {
      await this.ctx.workExecutionAuthority.markHostUnknown(claim.intent, hostOutcome.summary);
      return { invocation, hostOutcome, acceptance: null };
    }
    if (
      (['build.plan', 'build.check'].includes(claim.packet.work.kind) &&
        hostOutcome.status === 'succeeded') ||
      submission.status === 'outcome'
    ) {
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

  async claimExternal(request: WorkClaimRequest): Promise<ExternalWorkClaimResult> {
    const state = await this.ctx.runStore.loadRun(request.runId);
    const lifecycle = state.changeLifecycle;
    const work = lifecycle?.currentWork;
    const configuration = lifecycle?.buildProtocol?.configuration;
    if (
      lifecycle?.phase === 'build' &&
      work?.kind.startsWith('build.') &&
      work.kind !== 'build.configure' &&
      configuration
    ) {
      const anticipatedHost = this.externalHostIdentity(request.executor, [
        ...work.capabilities,
        ...(request.hostCapabilities ?? []),
      ]);
      if (
        anticipatedHost.id !== configuration.hostId ||
        configuration.hostCapabilities.some(
          (capability) => !anticipatedHost.capabilities.includes(capability),
        )
      ) {
        throw new Error(
          'External Runner does not match the Host approved by the Build Configuration',
        );
      }
    }
    const claim = await this.ctx.workDispatcher.claim(request);
    const host = this.externalHostIdentity(request.executor, [
      ...claim.packet.hostRequirement.capabilities,
      ...(request.hostCapabilities ?? []),
    ]);
    const invocation: WorkExecutionHostInvocation = {
      schemaVersion: 1,
      invocationId: invocationId(claim.packet.identity.packetDigest, host.id),
      host,
      packet: structuredClone(claim.packet.identity),
      startedAt: new Date().toISOString(),
    };
    await this.ctx.workExecutionAuthority.markHostStarted(claim.intent, invocation);
    return { ...claim, invocation };
  }

  async acceptExternalOutcome(
    input: ExternalWorkExecutionOutcome,
  ): Promise<ManagedWorkExecutionResult> {
    const intent = await this.ctx.workExecutionAuthority.loadIntent(input.runId);
    const state = await this.ctx.runStore.loadRun(input.runId);
    const invocation = state.workExecution?.hostInvocation;
    if (
      !invocation ||
      invocation.invocationId !== input.invocationId ||
      invocation.host.id !== input.hostId ||
      invocation.packet.packetDigest !== input.packetDigest ||
      invocation.packet.packetDigest !== state.workExecution?.packet.packetDigest
    ) {
      throw new Error('External Host Outcome does not match the authoritative invocation');
    }
    const proposedOutcome: WorkExecutionHostOutcome = {
      schemaVersion: 1,
      invocationId: input.invocationId,
      hostId: input.hostId,
      packetDigest: input.packetDigest,
      status: input.status,
      summary: input.summary,
      consumedLayerDigests: [...new Set(input.consumedLayerDigests)].sort(),
      ...(input.findings ? { findings: structuredClone(input.findings) } : {}),
      ...(input.result ? { result: structuredClone(input.result) } : {}),
      ...(input.delegationReceipts
        ? { delegationReceipts: structuredClone(input.delegationReceipts) }
        : {}),
      completedAt: new Date().toISOString(),
    };
    const persistedOutcome = state.workExecution?.hostOutcome;
    if (persistedOutcome && !sameHostOutcome(persistedOutcome, proposedOutcome)) {
      throw new Error('External Host Outcome conflicts with the persisted invocation result');
    }
    const hostOutcome = persistedOutcome ?? proposedOutcome;
    assertBoundedWorkExecutionFindings(hostOutcome);
    assertBoundedExecutionResult(hostOutcome);
    const packet = await this.ctx.workDispatcher.resumeClaim(input.runId);
    assertManagedDelegation(packet.packet, invocation.host, hostOutcome);
    await this.assertConsumedExecutionSkills(packet.packet, hostOutcome);
    const submission = persistedOutcome
      ? state.workExecution
      : await this.ctx.workExecutionAuthority.markHostCompleted(
          intent,
          hostOutcome,
          input.submissionId,
        );
    await this.ctx.workExecutionAuthority.recordDelegationFacts(packet.packet, hostOutcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      packet.packet,
      'consumed',
      hostOutcome.consumedLayerDigests,
    );
    if (
      await this.rejectInvalidConfigureResult({
        intent,
        workKind: packet.packet.work.kind,
        outcome: hostOutcome,
      })
    ) {
      return { invocation, hostOutcome, acceptance: null };
    }
    if (hostOutcome.status === 'unknown') {
      await this.ctx.workExecutionAuthority.markHostUnknown(intent, input.summary);
      return { invocation, hostOutcome, acceptance: null };
    }
    if (
      (['build.plan', 'build.check'].includes(packet.packet.work.kind) &&
        hostOutcome.status === 'succeeded') ||
      submission.status === 'outcome'
    ) {
      return { invocation, hostOutcome, acceptance: null };
    }
    const acceptance = await this.ctx.workDispatcher.acceptOutcome(
      this.ctx.workDispatcher.outcome(
        intent,
        hostOutcome.status === 'succeeded' ? 'succeeded' : 'failed',
        input.summary,
      ),
    );
    return { invocation, hostOutcome, acceptance };
  }

  async reconcile(runId: string): Promise<ManagedWorkExecutionResult | null> {
    const state = await this.ctx.runStore.loadRun(runId);
    const checkpoint = state.workExecution;
    const invocation = checkpoint?.hostInvocation;
    if (!checkpoint || !invocation || !['invoking', 'unknown'].includes(checkpoint.status)) {
      throw new Error('Run has no Host invocation requiring reconciliation');
    }
    const host = this.ctx.workExecutionHosts.get(invocation.host.id);
    if (!host?.reconcile || !invocation.host.reconcile) return null;
    const resolution = await host.reconcile(invocation);
    const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
    if (resolution.status === 'unknown') {
      await this.ctx.workExecutionAuthority.markHostUnknown(intent, resolution.reason);
      return null;
    }
    if (resolution.status === 'not-executed') {
      await this.ctx.workExecutionAuthority.markHostNotExecuted(intent, resolution.reason);
      return null;
    }
    const outcome = resolution.outcome;
    if (
      outcome.invocationId !== invocation.invocationId ||
      outcome.hostId !== invocation.host.id ||
      outcome.packetDigest !== invocation.packet.packetDigest
    ) {
      throw new Error('Reconciled Host Outcome identity mismatch');
    }
    assertBoundedWorkExecutionFindings(outcome);
    assertBoundedExecutionResult(outcome);
    const packet = await this.ctx.workDispatcher.resumeClaim(runId);
    assertManagedDelegation(packet.packet, invocation.host, outcome);
    await this.assertConsumedExecutionSkills(packet.packet, outcome);
    const submission = await this.ctx.workExecutionAuthority.markHostCompleted(
      intent,
      outcome,
      `reconcile:${invocation.invocationId}`,
    );
    await this.ctx.workExecutionAuthority.recordDelegationFacts(packet.packet, outcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      packet.packet,
      'consumed',
      outcome.consumedLayerDigests,
    );
    if (
      (['build.plan', 'build.check'].includes(packet.packet.work.kind) &&
        outcome.status === 'succeeded') ||
      submission.status === 'outcome'
    ) {
      return { invocation, hostOutcome: outcome, acceptance: null };
    }
    const acceptance = await this.ctx.workDispatcher.acceptOutcome(
      this.ctx.workDispatcher.outcome(
        intent,
        outcome.status === 'succeeded' ? 'succeeded' : 'failed',
        outcome.summary,
      ),
    );
    return { invocation, hostOutcome: outcome, acceptance };
  }

  private externalHostIdentity(
    executor: WorkExecutorIdentity,
    capabilities: readonly string[],
  ): WorkExecutionHostIdentity {
    const id = `external:${executor.source}:${executor.runnerId}`;
    const normalizedCapabilities = [...new Set(capabilities.map((capability) => capability.trim()))]
      .filter(Boolean)
      .sort();
    return {
      schemaVersion: 1,
      id,
      version: '1',
      codeDigest: `sha256:${createHash('sha256')
        .update(`${executor.source}\0${executor.runnerId}\0${normalizedCapabilities.join('\0')}`)
        .digest('hex')}`,
      capabilities: normalizedCapabilities,
      actionKinds: ['agent'],
      reconcile: false,
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    managedWorkExecutor: ManagedWorkExecutor;
  }
}
