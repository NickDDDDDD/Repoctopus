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
  WorkExecutionRecovery,
  WorkClaimResult,
  WorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { assertManagedDelegation } from '../domains/work-execution/delegation.js';
import { assertBoundedWorkExecutionFindings } from '../domains/work-execution/findings.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import {
  resolveBuildWorkOutcomeProcessor,
  UnregisteredBuildWorkOutcomeProcessorError,
} from '../domains/work-execution/acceptance.js';

function assertBoundedHostOutcome(outcome: unknown): void {
  let serialized: string;
  try {
    serialized = canonicalJson(outcome);
  } catch (error) {
    throw new Error('Work Execution Host Outcome is not a serializable payload', { cause: error });
  }
  if (serialized.length > 1024 * 1024) {
    throw new Error('Work Execution Host Outcome exceeds the bounded payload size');
  }
}

interface ExpectedHostOutcomeIdentity {
  invocationId: string;
  hostId: string;
  packetDigest: `sha256:${string}`;
}

type ParsedHostOutcome =
  | { valid: true; outcome: WorkExecutionHostOutcome }
  | { valid: false; outcome: WorkExecutionHostOutcome; diagnostic: string; rawPayload: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseHostOutcomeEnvelope(
  raw: unknown,
  expected: ExpectedHostOutcomeIdentity,
): ParsedHostOutcome {
  assertBoundedHostOutcome(raw);
  if (
    !isRecord(raw) ||
    raw.invocationId !== expected.invocationId ||
    raw.hostId !== expected.hostId ||
    raw.packetDigest !== expected.packetDigest
  ) {
    throw new Error('Work Execution Host Outcome identity mismatch');
  }
  const allowed = new Set([
    'schemaVersion',
    'invocationId',
    'hostId',
    'packetDigest',
    'status',
    'summary',
    'consumedLayerDigests',
    'findings',
    'result',
    'delegationReceipts',
    'completedAt',
  ]);
  const consumedLayerDigests = raw.consumedLayerDigests;
  const completedAt = typeof raw.completedAt === 'string' ? new Date(raw.completedAt) : null;
  const diagnostic =
    raw.schemaVersion !== 1
      ? 'Work Execution Host Outcome schemaVersion must be 1'
      : typeof raw.status !== 'string' ||
          !['succeeded', 'failed', 'unknown'].includes(raw.status)
        ? 'Work Execution Host Outcome status is invalid'
        : typeof raw.summary !== 'string' || !raw.summary.trim() || raw.summary.length > 2_048
          ? 'Work Execution Host Outcome summary must contain 1-2048 characters'
          : !Array.isArray(consumedLayerDigests) ||
              consumedLayerDigests.length > 256 ||
              consumedLayerDigests.some(
                (value) =>
                  typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value),
              )
            ? 'Work Execution Host Outcome consumedLayerDigests must be a bounded digest array'
            : new Set(consumedLayerDigests).size !== consumedLayerDigests.length
              ? 'Work Execution Host Outcome consumedLayerDigests must not contain duplicates'
              : !completedAt || Number.isNaN(completedAt.valueOf())
                ? 'Work Execution Host Outcome completedAt is invalid'
                : Object.keys(raw).some((key) => !allowed.has(key))
                  ? 'Work Execution Host Outcome contains unsupported envelope fields'
                  : null;
  if (!diagnostic) {
    return { valid: true, outcome: structuredClone(raw) as unknown as WorkExecutionHostOutcome };
  }
  return {
    valid: false,
    diagnostic,
    rawPayload: structuredClone(raw),
    outcome: {
      schemaVersion: 1,
      ...expected,
      status: 'failed',
      summary: diagnostic,
      consumedLayerDigests: [],
      completedAt:
        completedAt && !Number.isNaN(completedAt.valueOf())
          ? completedAt.toISOString()
          : new Date().toISOString(),
    },
  };
}

function parseExternalHostOutcomeEnvelope(
  raw: unknown,
  expected: ExpectedHostOutcomeIdentity,
): ParsedHostOutcome {
  assertBoundedHostOutcome(raw);
  if (
    !isRecord(raw) ||
    raw.invocationId !== expected.invocationId ||
    raw.hostId !== expected.hostId ||
    raw.packetDigest !== expected.packetDigest
  ) {
    throw new Error('External Host Outcome does not match the authoritative invocation');
  }
  const candidate = {
    schemaVersion: 1,
    invocationId: raw.invocationId,
    hostId: raw.hostId,
    packetDigest: raw.packetDigest,
    status: raw.status,
    summary: raw.summary,
    consumedLayerDigests: raw.consumedLayerDigests,
    ...(raw.findings === undefined ? {} : { findings: raw.findings }),
    ...(raw.result === undefined ? {} : { result: raw.result }),
    ...(raw.delegationReceipts === undefined
      ? {}
      : { delegationReceipts: raw.delegationReceipts }),
    completedAt: new Date().toISOString(),
  };
  const parsed = parseHostOutcomeEnvelope(candidate, expected);
  const allowed = new Set([
    'schemaVersion',
    'runId',
    'submissionId',
    'invocationId',
    'hostId',
    'packetDigest',
    'status',
    'summary',
    'consumedLayerDigests',
    'findings',
    'result',
    'delegationReceipts',
  ]);
  const externalDiagnostic =
    raw.schemaVersion !== 3
      ? 'External Host Outcome schemaVersion must be 3'
      : typeof raw.runId !== 'string' || !raw.runId.trim()
        ? 'External Host Outcome runId is invalid'
        : typeof raw.submissionId !== 'string' || !raw.submissionId.trim()
          ? 'External Host Outcome submissionId is invalid'
          : Object.keys(raw).some((key) => !allowed.has(key))
            ? 'External Host Outcome contains unsupported envelope fields'
            : null;
  if (!externalDiagnostic && parsed.valid) return parsed;
  const diagnostic =
    externalDiagnostic ??
    (parsed.valid ? 'External Host Outcome envelope is invalid' : parsed.diagnostic);
  return {
    valid: false,
    diagnostic,
    rawPayload: structuredClone(raw),
    outcome: parsed.outcome,
  };
}

function assertBoundedExecutionResult(outcome: WorkExecutionHostOutcome): void {
  if (outcome.result && canonicalJson(outcome.result).length > 1024 * 1024) {
    throw new Error('Work Execution result exceeds the bounded payload size');
  }
  if (outcome.result?.kind === 'build-plan-candidate' && outcome.result.packages.length > 256) {
    throw new Error('Build Plan candidate exceeds the package bound');
  }
  const receipts: readonly unknown[] = Array.isArray(outcome.delegationReceipts)
    ? outcome.delegationReceipts
    : outcome.delegationReceipts === undefined
      ? []
      : (() => {
          throw new Error('Delegation receipts must be an array');
        })();
  if (
    receipts.length > 64 ||
    new Set(
      receipts.map((receipt) =>
        receipt && typeof receipt === 'object'
          ? (receipt as Record<string, unknown>).receiptId
          : undefined,
      ),
    ).size !== receipts.length
  ) {
    throw new Error('Delegation receipts are duplicated or exceed the bounded receipt count');
  }
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      throw new Error('Delegation receipt does not match the parent Host invocation');
    }
    const candidate = receipt as Record<string, unknown>;
    if (
      candidate.schemaVersion !== 1 ||
      candidate.parentInvocationId !== outcome.invocationId ||
      candidate.coordinatorHostId !== outcome.hostId ||
      typeof candidate.executionId !== 'string' ||
      !candidate.executionId.trim() ||
      typeof candidate.packageId !== 'string' ||
      !candidate.packageId.trim() ||
      typeof candidate.role !== 'string' ||
      !['implementer', 'reviewer'].includes(candidate.role) ||
      typeof candidate.status !== 'string' ||
      !['succeeded', 'failed', 'unknown'].includes(candidate.status) ||
      typeof candidate.outcomeDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(candidate.outcomeDigest)
    ) {
      throw new Error('Delegation receipt does not match the parent Host invocation');
    }
  }
  if (!outcome.result) return;
  if (typeof outcome.result !== 'object' || Array.isArray(outcome.result)) {
    throw new Error('Work Execution result must be an object');
  }
  const result = outcome.result as Record<string, unknown>;
  const common = ['schemaVersion', 'kind'];
  const allowed =
    result.kind === 'execution-binding-candidate'
      ? [...common, 'strategyDigest']
      : result.kind === 'build-plan-candidate'
        ? [...common, 'packages']
        : result.kind === 'build-package-completion'
          ? [
              ...common,
              'packageId',
              'acceptanceEvidenceIds',
              'testEvidenceIds',
              'tddEvidence',
              'implementationDigest',
            ]
          : result.kind === 'build-check-candidate'
            ? [
                ...common,
                'completedPackageIds',
                'acceptedTaskIds',
                'testEvidenceIds',
                'implementationDigest',
                'reviewerExecutionId',
              ]
            : [];
  if (
    result.schemaVersion !== 1 ||
    allowed.length === 0 ||
    Object.keys(result).some((key) => !allowed.includes(key))
  ) {
    throw new Error('Work Execution result does not match the managed Build result schema');
  }
  const digest = (value: unknown) =>
    typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
  const stringList = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
  const nonEmpty = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
  if (result.kind === 'execution-binding-candidate' && !digest(result.strategyDigest)) {
    throw new Error('Execution Binding candidate strategyDigest must be a SHA-256 digest');
  }
  if (
    result.kind === 'build-plan-candidate' &&
    (!Array.isArray(result.packages) || result.packages.length > 256)
  ) {
    throw new Error('Build Plan candidate packages must be a bounded array');
  }
  if (result.kind === 'build-package-completion') {
    const tdd = result.tddEvidence;
    if (
      !nonEmpty(result.packageId) ||
      !stringList(result.acceptanceEvidenceIds) ||
      !stringList(result.testEvidenceIds) ||
      !digest(result.implementationDigest) ||
      (tdd !== undefined &&
        (!tdd ||
          typeof tdd !== 'object' ||
          Array.isArray(tdd) ||
          Object.keys(tdd).some(
            (key) => !['redEvidenceId', 'greenEvidenceId', 'regressionEvidenceId'].includes(key),
          ) ||
          !nonEmpty((tdd as Record<string, unknown>).redEvidenceId) ||
          !nonEmpty((tdd as Record<string, unknown>).greenEvidenceId) ||
          !nonEmpty((tdd as Record<string, unknown>).regressionEvidenceId)))
    ) {
      throw new Error('Build Package completion does not match the managed result schema');
    }
  }
  if (
    result.kind === 'build-check-candidate' &&
    (!stringList(result.completedPackageIds) ||
      !stringList(result.acceptedTaskIds) ||
      !stringList(result.testEvidenceIds) ||
      !digest(result.implementationDigest) ||
      !nonEmpty(result.reviewerExecutionId))
  ) {
    throw new Error('Build Check candidate does not match the managed result schema');
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

export type ManagedWorkExecutionResult =
  | {
      executionAcquired: true;
      invocation: WorkExecutionHostInvocation;
      hostOutcome: WorkExecutionHostOutcome;
      acceptance: WorkOutcomeAcceptance | null;
    }
  | {
      executionAcquired: false;
      invocation: WorkExecutionHostInvocation;
      hostOutcome: null;
      acceptance: null;
    };

export type ExternalWorkClaimResult = WorkClaimResult &
  (
    | {
        executionAcquired: true;
        invocation: WorkExecutionHostInvocation;
      }
    | {
        executionAcquired: false;
        invocation: WorkExecutionHostInvocation;
        recovery: WorkExecutionRecovery;
      }
  );

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
    const acquisition = await this.ctx.workExecutionAuthority.markHostStarted(
      claim.intent,
      invocation,
    );
    if (!acquisition.acquired) {
      return {
        executionAcquired: false,
        invocation: acquisition.checkpoint.hostInvocation!,
        hostOutcome: null,
        acceptance: null,
      };
    }
    const session = this.ctx.workExecutionSessions.open({
      runId: claim.intent.runId,
      workId: claim.intent.workId,
      attempt: claim.intent.attempt,
      checkEpoch: claim.intent.checkEpoch,
      invocationId: invocation.invocationId,
      packetDigest: claim.packet.identity.packetDigest,
      hostId: host.identity.id,
    });
    let rawHostOutcome: unknown;
    try {
      rawHostOutcome = await host.invoke(claim.packet, session);
    } catch (error) {
      await this.ctx.workExecutionAuthority.markHostUnknown(
        claim.intent,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      this.ctx.workExecutionSessions.close(session.sessionId);
    }
    let parsedHostOutcome: ParsedHostOutcome;
    try {
      parsedHostOutcome = parseHostOutcomeEnvelope(rawHostOutcome, {
        invocationId: invocation.invocationId,
        hostId: host.identity.id,
        packetDigest: claim.packet.identity.packetDigest,
      });
    } catch (error) {
      await this.ctx.workExecutionAuthority.markHostUnknown(
        claim.intent,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    const hostOutcome = parsedHostOutcome.outcome;
    const submission = await this.ctx.workExecutionAuthority.markHostCompleted(
      claim.intent,
      hostOutcome,
      randomUUID(),
      parsedHostOutcome.valid ? undefined : parsedHostOutcome.rawPayload,
    );
    if (!parsedHostOutcome.valid) {
      await this.ctx.workExecutionAuthority.rejectHostSubmission({
        intent: claim.intent,
        reasonCode: 'output-invalid',
        diagnostic: parsedHostOutcome.diagnostic,
      });
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    try {
      if (claim.packet.work.phase === 'build' && hostOutcome.status === 'succeeded') {
        resolveBuildWorkOutcomeProcessor(claim.packet.work.kind);
      }
      assertBoundedWorkExecutionFindings(hostOutcome);
      assertBoundedExecutionResult(hostOutcome);
      assertManagedDelegation(claim.packet, host.identity, hostOutcome);
      await this.assertConsumedExecutionSkills(claim.packet, hostOutcome);
    } catch (error) {
      await this.ctx.workExecutionAuthority.rejectHostSubmission({
        intent: claim.intent,
        reasonCode:
          error instanceof UnregisteredBuildWorkOutcomeProcessorError
            ? 'outcome-processing-error'
            : 'output-invalid',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    await this.ctx.workExecutionAuthority.recordDelegationFacts(claim.packet, hostOutcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      claim.packet,
      'consumed',
      hostOutcome.consumedLayerDigests,
      hostOutcome.invocationId,
    );
    if (hostOutcome.status === 'unknown') {
      await this.ctx.workExecutionAuthority.markHostUnknown(claim.intent, hostOutcome.summary);
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    if (
      (claim.packet.work.phase === 'build' && hostOutcome.status === 'succeeded') ||
      submission.status === 'outcome'
    ) {
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    const acceptance = await this.ctx.workDispatcher.acceptOutcome(
      this.ctx.workDispatcher.outcome(
        claim.intent,
        hostOutcome.status === 'succeeded' ? 'succeeded' : 'failed',
        hostOutcome.summary,
      ),
    );
    return { executionAcquired: true, invocation, hostOutcome, acceptance };
  }

  async claimExternal(request: WorkClaimRequest): Promise<ExternalWorkClaimResult> {
    const state = await this.ctx.runStore.loadRun(request.runId);
    const lifecycle = state.changeLifecycle;
    const hostCapabilities = [...new Set(request.hostCapabilities ?? [])].sort();
    const expectedBinding = lifecycle?.buildProtocol?.binding;
    const externalHostId = `external:${request.executor.source}:${request.executor.runnerId}`;
    if (
      lifecycle?.phase === 'build' &&
      lifecycle.currentWork?.kind !== 'build.configure' &&
      expectedBinding &&
      expectedBinding.coordinatorHostId !== externalHostId
    ) {
      throw new Error(
        'External Runner does not match the current Execution Binding Host; Build Configure must revalidate it before claim',
      );
    }
    const claim = await this.ctx.workDispatcher.claim({ ...request, hostCapabilities });
    const host = this.externalHostIdentity(request.executor, hostCapabilities);
    const invocation: WorkExecutionHostInvocation = {
      schemaVersion: 1,
      invocationId: invocationId(claim.packet.identity.packetDigest, host.id),
      host,
      packet: structuredClone(claim.packet.identity),
      startedAt: new Date().toISOString(),
    };
    const acquisition = await this.ctx.workExecutionAuthority.markHostStarted(
      claim.intent,
      invocation,
    );
    if (!acquisition.acquired) {
      return {
        ...claim,
        executionAcquired: false,
        invocation: acquisition.checkpoint.hostInvocation!,
        recovery: await this.ctx.workExecutionAuthority.recovery(request.runId),
      };
    }
    return { ...claim, executionAcquired: true, invocation };
  }

  async acceptExternalOutcome(
    input: ExternalWorkExecutionOutcome,
  ): Promise<ManagedWorkExecutionResult> {
    const rawInput: unknown = input;
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
    const parsedHostOutcome = parseExternalHostOutcomeEnvelope(rawInput, {
      invocationId: invocation.invocationId,
      hostId: invocation.host.id,
      packetDigest: invocation.packet.packetDigest,
    });
    const proposedOutcome = parsedHostOutcome.outcome;
    const persistedOutcome = state.workExecution?.hostOutcome;
    if (persistedOutcome && !sameHostOutcome(persistedOutcome, proposedOutcome)) {
      throw new Error('External Host Outcome conflicts with the persisted invocation result');
    }
    const hostOutcome = persistedOutcome ?? proposedOutcome;
    const packet = await this.ctx.workDispatcher.resumeClaim(input.runId);
    const submissionId =
      typeof input.submissionId === 'string' && input.submissionId.trim()
        ? input.submissionId
        : `invalid:${createHash('sha256').update(canonicalJson(rawInput)).digest('hex').slice(0, 32)}`;
    const submission = persistedOutcome
      ? state.workExecution
      : await this.ctx.workExecutionAuthority.markHostCompleted(
          intent,
          hostOutcome,
          submissionId,
          parsedHostOutcome.valid ? undefined : parsedHostOutcome.rawPayload,
        );
    if (!parsedHostOutcome.valid) {
      await this.ctx.workExecutionAuthority.rejectHostSubmission({
        intent,
        reasonCode: 'output-invalid',
        diagnostic: parsedHostOutcome.diagnostic,
      });
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    try {
      if (packet.packet.work.phase === 'build' && hostOutcome.status === 'succeeded') {
        resolveBuildWorkOutcomeProcessor(packet.packet.work.kind);
      }
      assertBoundedWorkExecutionFindings(hostOutcome);
      assertBoundedExecutionResult(hostOutcome);
      assertManagedDelegation(packet.packet, invocation.host, hostOutcome);
      await this.assertConsumedExecutionSkills(packet.packet, hostOutcome);
    } catch (error) {
      await this.ctx.workExecutionAuthority.rejectHostSubmission({
        intent,
        reasonCode:
          error instanceof UnregisteredBuildWorkOutcomeProcessorError
            ? 'outcome-processing-error'
            : 'output-invalid',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    await this.ctx.workExecutionAuthority.recordDelegationFacts(packet.packet, hostOutcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      packet.packet,
      'consumed',
      hostOutcome.consumedLayerDigests,
      hostOutcome.invocationId,
    );
    if (hostOutcome.status === 'unknown') {
      await this.ctx.workExecutionAuthority.markHostUnknown(intent, input.summary);
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    if (
      (packet.packet.work.phase === 'build' && hostOutcome.status === 'succeeded') ||
      submission.status === 'outcome'
    ) {
      return { executionAcquired: true, invocation, hostOutcome, acceptance: null };
    }
    const acceptance = await this.ctx.workDispatcher.acceptOutcome(
      this.ctx.workDispatcher.outcome(
        intent,
        hostOutcome.status === 'succeeded' ? 'succeeded' : 'failed',
        input.summary,
      ),
    );
    return { executionAcquired: true, invocation, hostOutcome, acceptance };
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
    const rawOutcome: unknown = resolution.outcome;
    let parsedHostOutcome: ParsedHostOutcome;
    try {
      parsedHostOutcome = parseHostOutcomeEnvelope(rawOutcome, {
        invocationId: invocation.invocationId,
        hostId: invocation.host.id,
        packetDigest: invocation.packet.packetDigest,
      });
    } catch (error) {
      await this.ctx.workExecutionAuthority.markHostUnknown(
        intent,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    const outcome = parsedHostOutcome.outcome;
    const packet = await this.ctx.workDispatcher.resumeClaim(runId);
    const submission = await this.ctx.workExecutionAuthority.markHostCompleted(
      intent,
      outcome,
      `reconcile:${invocation.invocationId}`,
      parsedHostOutcome.valid ? undefined : parsedHostOutcome.rawPayload,
    );
    if (!parsedHostOutcome.valid) {
      await this.ctx.workExecutionAuthority.rejectHostSubmission({
        intent,
        reasonCode: 'output-invalid',
        diagnostic: parsedHostOutcome.diagnostic,
      });
      return { executionAcquired: true, invocation, hostOutcome: outcome, acceptance: null };
    }
    try {
      if (packet.packet.work.phase === 'build' && outcome.status === 'succeeded') {
        resolveBuildWorkOutcomeProcessor(packet.packet.work.kind);
      }
      assertBoundedWorkExecutionFindings(outcome);
      assertBoundedExecutionResult(outcome);
      assertManagedDelegation(packet.packet, invocation.host, outcome);
      await this.assertConsumedExecutionSkills(packet.packet, outcome);
    } catch (error) {
      await this.ctx.workExecutionAuthority.rejectHostSubmission({
        intent,
        reasonCode:
          error instanceof UnregisteredBuildWorkOutcomeProcessorError
            ? 'outcome-processing-error'
            : 'output-invalid',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      return { executionAcquired: true, invocation, hostOutcome: outcome, acceptance: null };
    }
    await this.ctx.workExecutionAuthority.recordDelegationFacts(packet.packet, outcome);
    await this.ctx.workExecutionAuthority.recordSkillFacts(
      packet.packet,
      'consumed',
      outcome.consumedLayerDigests,
      outcome.invocationId,
    );
    if (
      (packet.packet.work.phase === 'build' && outcome.status === 'succeeded') ||
      submission.status === 'outcome'
    ) {
      return { executionAcquired: true, invocation, hostOutcome: outcome, acceptance: null };
    }
    const acceptance = await this.ctx.workDispatcher.acceptOutcome(
      this.ctx.workDispatcher.outcome(
        intent,
        outcome.status === 'succeeded' ? 'succeeded' : 'failed',
        outcome.summary,
      ),
    );
    return { executionAcquired: true, invocation, hostOutcome: outcome, acceptance };
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
