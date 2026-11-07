import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createEvidenceFingerprint,
  type EvidenceFingerprint,
} from '../domains/evidence/fingerprint.js';
import { projectEvidenceGate } from '../domains/evidence/gate.js';
import { assertEvidenceNodeInputSnapshot } from '../domains/evidence/input-snapshot.js';
import { createAcceptanceTrace } from '../domains/evidence/acceptance-trace.js';
import { recoverEvidenceAttempt } from '../domains/evidence/recovery.js';
import { EvidenceService, type EvidenceRunResult } from '../domains/evidence/service.js';
import {
  createEvidenceTelemetryBatch,
  type EvidenceTelemetryPort,
} from '../domains/evidence/telemetry.js';
import type {
  EvidenceAttempt,
  EvidenceAcceptanceContext,
  EvidenceBundle,
  EvidenceGateProjection,
} from '../domains/evidence/types.js';
import { compileEvidenceProfile, type EvidenceExecutionPlan } from '../domains/feedback/profile.js';
import type { RequirementsConflictDecisionRequest } from '../domains/feedback/visual.js';
import type { EffectiveProjectConfig } from '../domains/project-configuration/types.js';
import { atomicWriteJson } from '../platform/filesystem/atomic-write.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import { FileEvidenceJournal } from '../platform/evidence/file-evidence-journal.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { FileEvidenceInputProofs } from '../platform/evidence/file-input-proofs.js';
import { evidenceReceiptInputCurrent } from '../domains/evidence/receipt.js';
import {
  evidenceInputDigest,
  EvidenceInputDriftError,
} from '../domains/evidence/input-snapshot.js';
import {
  FileEvidenceRetention,
  type EvidenceCleanupResult,
} from '../platform/evidence/retention.js';
import { collectRepositoryFingerprint } from '../platform/git/evidence-fingerprint.js';
import { observeEvidenceNodeInputs } from '../platform/evidence/node-input-observation.js';
import { loadProjectConfig } from '../platform/project-configuration/file-config.js';
import {
  FileResourceLeaseManager,
  ResourceLeaseConflictError,
} from '../platform/runtime/resource-lease.js';
import { FileEvidenceTelemetryOutbox } from '../platform/telemetry/evidence-outbox.js';
import { EvidenceObservationTelemetry } from './observation-telemetry.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';

interface WorkflowEvidenceBinding {
  workflowRunId: string;
  workflowActionId: string;
  workflowStepId: string;
  workflowStateVersion?: number;
  checkEpoch?: number;
  workflowInputDigest?: `sha256:${string}`;
  expectedEvidenceFingerprint?: string;
  acceptanceContext?: EvidenceAcceptanceContext;
}

interface EvidenceRunContext {
  schemaVersion: 2;
  kind: 'EvidenceRunContext';
  attemptId: string;
  profileId: string;
  repositoryOverrides: EvidenceRepositoryOverride[] | null;
  workflowBinding: WorkflowEvidenceBinding | null;
  status: 'running' | 'completed' | 'recovered';
  plan: EvidenceExecutionPlan;
  fingerprint: EvidenceFingerprint;
  bundleId: string | null;
  decisionRequests: RequirementsConflictDecisionRequest[];
  updatedAt: string;
}

export interface EvidenceRepositoryOverride {
  repositoryId: string;
  root: string;
  head?: string;
}

export interface EvidenceStatus {
  context: EvidenceRunContext;
  attempt: EvidenceAttempt;
  bundle: EvidenceBundle | null;
  gate: EvidenceGateProjection | null;
}

export interface EvidenceTelemetryStatus {
  status: 'exported' | 'pending' | 'not_ready';
  exportedEvents: number;
  diagnostic?: string;
}

function asContext(value: unknown): EvidenceRunContext {
  const record = value as Partial<EvidenceRunContext> | null;
  const fingerprintSchema = (
    record?.fingerprint as { manifest?: { schemaVersion?: unknown } } | undefined
  )?.manifest?.schemaVersion;
  if (fingerprintSchema !== undefined && fingerprintSchema !== 3) {
    const actualSchema =
      typeof fingerprintSchema === 'number' ? fingerprintSchema : typeof fingerprintSchema;
    throw new Error(`Unsupported Evidence fingerprint schema: ${actualSchema}; recollect Evidence`);
  }
  const binding = record?.workflowBinding;
  if (
    !record ||
    typeof record !== 'object' ||
    record.schemaVersion !== 2 ||
    record.kind !== 'EvidenceRunContext' ||
    typeof record.attemptId !== 'string' ||
    typeof record.profileId !== 'string' ||
    !record.fingerprint ||
    fingerprintSchema !== 3 ||
    (record.repositoryOverrides !== undefined &&
      record.repositoryOverrides !== null &&
      (!Array.isArray(record.repositoryOverrides) ||
        record.repositoryOverrides.some(
          (item) =>
            !item ||
            typeof item !== 'object' ||
            typeof item.repositoryId !== 'string' ||
            typeof item.root !== 'string' ||
            (item.head !== undefined && typeof item.head !== 'string'),
        ))) ||
    !['running', 'completed', 'recovered'].includes(record.status ?? '') ||
    (binding !== null &&
      (!binding ||
        typeof binding.workflowRunId !== 'string' ||
        typeof binding.workflowActionId !== 'string' ||
        typeof binding.workflowStepId !== 'string' ||
        (binding.workflowStateVersion !== undefined &&
          (!Number.isSafeInteger(binding.workflowStateVersion) ||
            binding.workflowStateVersion < 0)) ||
        (binding.checkEpoch !== undefined &&
          (!Number.isSafeInteger(binding.checkEpoch) || binding.checkEpoch < 0)) ||
        (binding.workflowStateVersion === undefined && binding.checkEpoch === undefined) ||
        (binding.workflowInputDigest !== undefined &&
          !/^sha256:[a-f0-9]{64}$/u.test(binding.workflowInputDigest)) ||
        (binding.expectedEvidenceFingerprint !== undefined &&
          typeof binding.expectedEvidenceFingerprint !== 'string') ||
        (binding.acceptanceContext !== undefined &&
          (!binding.acceptanceContext ||
            !/^sha256:[a-f0-9]{64}$/u.test(binding.acceptanceContext.verificationInputDigest) ||
            !/^sha256:[a-f0-9]{64}$/u.test(binding.acceptanceContext.acceptanceSetHash) ||
            !Array.isArray(binding.acceptanceContext.acceptanceIds) ||
            !Array.isArray(binding.acceptanceContext.acceptanceCoverage)))))
  ) {
    throw new Error('Invalid EvidenceRunContext');
  }
  const fingerprint = record.fingerprint;
  fingerprint.manifest.nodeInputs.forEach(assertEvidenceNodeInputSnapshot);
  if (createEvidenceFingerprint(fingerprint.manifest).digest !== fingerprint.digest)
    throw new Error('Evidence fingerprint content digest mismatch');
  return {
    ...(record as EvidenceRunContext),
    repositoryOverrides: record.repositoryOverrides ?? null,
  };
}

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface EvidenceCoordinatorConfig {
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  telemetry?: EvidenceTelemetryPort;
}

export class EvidenceCoordinator extends Service {
  static inject = [
    'compositionIdentity',
    'evidenceAdapters',
    'repositoryInputPolicies',
    'runStore',
  ];

  private readonly store: FileEvidenceStore;
  private readonly journal: FileEvidenceJournal;
  private readonly leases: FileResourceLeaseManager;
  private readonly telemetryOutbox: FileEvidenceTelemetryOutbox;
  private readonly workspace: string;
  private readonly telemetry: EvidenceTelemetryPort;
  private readonly operations: OperationOwnership;

  constructor(context: Context, config: EvidenceCoordinatorConfig) {
    super(context, 'evidenceCoordinator');
    this.operations = bindOperationOwnership(context, 'evidenceCoordinator');
    this.workspace = path.resolve(config.workspaceRoot);
    const observationDelivery = context.get('observationDelivery');
    this.telemetry =
      config.telemetry ??
      (observationDelivery
        ? new EvidenceObservationTelemetry(observationDelivery, config.environment ?? process.env)
        : { async export() {} });
    this.store = new FileEvidenceStore(this.workspace);
    this.journal = new FileEvidenceJournal(this.workspace);
    this.leases = new FileResourceLeaseManager(this.workspace);
    this.telemetryOutbox = new FileEvidenceTelemetryOutbox(this.workspace);
  }

  private contextFile(attemptId: string): string {
    return path.join(this.workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
  }

  private async loadContext(attemptId: string): Promise<EvidenceRunContext> {
    return asContext(JSON.parse(await readFile(this.contextFile(attemptId), 'utf8')) as unknown);
  }

  private assertRunOwner(
    context: EvidenceRunContext,
    profileId: string,
    workflowRunId: string,
  ): void {
    if (
      context.profileId !== profileId ||
      context.workflowBinding?.workflowRunId !== workflowRunId
    ) {
      throw new Error(`Evidence attempt ownership mismatch: ${context.attemptId}`);
    }
  }

  async lookup(attemptId: string): Promise<EvidenceStatus | null> {
    return optional(() => this.status(attemptId));
  }

  async hasUnsettledWorkAttempt(workflowRunId: string, workId: string): Promise<boolean> {
    return (await this.unsettledWorkAttemptIds(workflowRunId, workId)).length > 0;
  }
  async unsettledWorkAttemptIds(workflowRunId: string, workId: string): Promise<string[]> {
    const ids: string[] = [];
    for (const context of await this.contexts()) {
      if (
        context.workflowBinding?.workflowRunId !== workflowRunId ||
        context.workflowBinding.workflowActionId !== workId
      )
        continue;
      if (context.status === 'running') {
        ids.push(context.attemptId);
        continue;
      }
      if (context.bundleId) {
        const bundle = await this.store.loadBundle(context.bundleId);
        if (bundle.findings.some((finding) => finding.code === 'recovery-uncertain-side-effect'))
          ids.push(context.attemptId);
      }
    }
    return ids.sort();
  }

  private async effectiveConfig(
    profileId: string,
    repositoryOverrides: readonly EvidenceRepositoryOverride[] | null,
  ): Promise<EffectiveProjectConfig> {
    const config = await loadProjectConfig(this.workspace);
    if (repositoryOverrides === null) return config;
    const overrides = new Map<string, string>();
    for (const item of repositoryOverrides) {
      if (!item.repositoryId.trim() || overrides.has(item.repositoryId)) {
        throw new Error('Evidence repository overrides contain duplicate or empty identities');
      }
      overrides.set(item.repositoryId, path.resolve(item.root));
    }
    const profile = config.shared.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error(`Evidence profile not found: ${profileId}`);
    const expected = [...new Set(profile.nodes.map((node) => node.repository))].sort();
    const received = [...overrides.keys()].sort();
    if (JSON.stringify(expected) !== JSON.stringify(received)) {
      throw new Error(
        'Evidence repository overrides must exactly cover the selected profile repository set',
      );
    }
    return {
      ...config,
      repositories: config.repositories
        .filter((repository) => overrides.has(repository.id))
        .map((repository) => ({
          ...repository,
          resolvedPath: overrides.get(repository.id)!,
        })),
    };
  }

  private async fingerprint(
    profileId: string,
    config: EffectiveProjectConfig,
    workflowRunId: string | null = null,
  ): Promise<EvidenceFingerprint> {
    const hasVisualAdapter = this.ctx.evidenceAdapters.has('visual') && !!config.local?.visual;
    const inputPolicy = this.ctx.repositoryInputPolicies.current();
    const repositories = await Promise.all(
      config.repositories.map((repository) =>
        collectRepositoryFingerprint({
          repositoryId: repository.id,
          root: repository.resolvedPath,
          policy: inputPolicy,
        }),
      ),
    );
    let projection;
    if (workflowRunId) {
      const state = await this.ctx.runStore.loadRun(workflowRunId);
      const lifecycle = state.changeLifecycle;
      if (lifecycle) {
        const specification = this.ctx.get('specification');
        if (!specification) throw new Error('Evidence requires the bound Specification Provider');
        projection = await specification.evidenceProjection(lifecycle.identity.changeId);
        const { digest: projectionDigest, ...projectionFacts } = projection;
        if (
          projection.schemaVersion !== 1 ||
          projection.changeId !== lifecycle.identity.changeId ||
          projectionDigest !== evidenceInputDigest(projectionFacts) ||
          evidenceInputDigest(projection.provider) !==
            evidenceInputDigest(specification.identity()) ||
          evidenceInputDigest(projection.root) !== evidenceInputDigest(specification.root()) ||
          projection.tasks.tasks.length !== (lifecycle.tasks ?? []).length
        ) {
          throw new Error(
            'Specification Evidence projection does not match the bound Run authority',
          );
        }
        for (const task of projection.tasks.tasks) {
          const accepted = lifecycle.tasks?.find(
            (entry) => entry.taskId === task.taskId && entry.taskRevision === task.taskRevision,
          );
          if (
            !accepted ||
            task.status !== accepted.status ||
            (task.status === 'completed' &&
              (task.completion?.source !== 'runtime-work' ||
                accepted.completion?.source !== 'runtime-work' ||
                task.completion.workId !== accepted.completion.workId))
          ) {
            throw new Error(
              'Official Task completion is not backed by the current Run accepted facts',
            );
          }
        }
      }
    }
    const adapters = {
      command: 'local/v3',
      service: 'local/v1',
      browser: 'playwright-core/v2',
      visual: hasVisualAdapter ? 'file-exchange-or-provided/v1' : 'unavailable/v1',
    };
    const nodeInputs = await observeEvidenceNodeInputs({
      plan: compileEvidenceProfile(config, profileId),
      config,
      repositories,
      policy: inputPolicy,
      adapters,
      ...(projection ? { projection } : {}),
    });
    return createEvidenceFingerprint({
      schemaVersion: 3,
      profileId,
      sharedConfigDigest: config.sharedDigest,
      localConfigDigest: config.localDigest,
      repositories,
      nodeInputs,
      planningProjection: projection ?? null,
      tools: { node: process.version },
      adapters,
      inputArtifactDigests: [],
    });
  }

  private async workflowBinding(
    workflowRunId: string | null,
    profileId: string,
  ): Promise<WorkflowEvidenceBinding | null> {
    if (workflowRunId === null) return null;
    const [state, workflow] = await Promise.all([
      this.ctx.runStore.loadRun(workflowRunId),
      this.ctx.runStore.loadWorkflow(workflowRunId),
    ]);
    const compositionDigest = this.ctx.compositionIdentity.current().compositionDigest;
    if (state.composition.compositionDigest !== compositionDigest) {
      throw new Error(
        `Workflow run ${workflowRunId} requires composition ${state.composition.compositionDigest}; current composition ${compositionDigest} is migration_required`,
      );
    }
    const lifecycle = state.changeLifecycle;
    if (lifecycle?.phase === 'verify') {
      const work = lifecycle.currentWork;
      const verification = lifecycle.verificationInput;
      if (
        state.status !== 'running' ||
        !work ||
        work.kind !== 'evidence.verify' ||
        !verification ||
        work.inputDigest !== verification.digest
      ) {
        throw new Error(`Change Run ${workflowRunId} has no active Verify Work`);
      }
      if (verification.evidenceProfile.id !== profileId) {
        throw new Error(
          `Verify Work requires evidence profile ${verification.evidenceProfile.id}, not ${profileId}`,
        );
      }
      return {
        workflowRunId,
        workflowActionId: work.workId,
        workflowStepId: 'verify',
        checkEpoch: lifecycle.checkEpoch,
        workflowInputDigest: verification.digest,
        expectedEvidenceFingerprint: verification.evidenceProfile.fingerprintDigest,
        acceptanceContext: {
          verificationInputDigest: verification.digest,
          acceptanceSetHash: verification.acceptanceSetHash,
          acceptanceIds: verification.acceptanceCriteria.map((criterion) => criterion.acceptanceId),
          acceptanceCoverage: verification.acceptanceCoverage.map((coverage) => ({
            acceptanceId: coverage.acceptanceId,
            nodeIds: [...coverage.nodeIds],
          })),
        },
      };
    }
    if (
      state.status !== 'waiting' ||
      state.pendingActionId === null ||
      state.currentStep === null
    ) {
      throw new Error(`Workflow run ${workflowRunId} has no pending action to verify`);
    }
    const step = workflow.definition.steps.find((candidate) => candidate.id === state.currentStep);
    if (!step) throw new Error(`Workflow run ${workflowRunId} has an unknown current step`);
    if (step.action.evidenceProfile !== profileId) {
      throw new Error(
        `Workflow step ${step.id} requires evidence profile ${step.action.evidenceProfile ?? '(none)'}, not ${profileId}`,
      );
    }
    return {
      workflowRunId,
      workflowActionId: state.pendingActionId,
      workflowStepId: step.id,
      workflowStateVersion: state.stateVersion,
    };
  }

  async plan(
    profileId: string,
    workflowRunId: string | null = null,
  ): Promise<{
    plan: EvidenceExecutionPlan;
    fingerprint: EvidenceFingerprint;
  }> {
    return this.planWithRepositories(profileId, null, workflowRunId);
  }

  async compile(profileId: string): Promise<EvidenceExecutionPlan> {
    const config = await this.effectiveConfig(profileId, null);
    return compileEvidenceProfile(config, profileId);
  }

  private async planWithRepositories(
    profileId: string,
    repositoryOverrides: readonly EvidenceRepositoryOverride[] | null,
    workflowRunId: string | null = null,
  ): Promise<{
    config: EffectiveProjectConfig;
    plan: EvidenceExecutionPlan;
    fingerprint: EvidenceFingerprint;
  }> {
    const config = await this.effectiveConfig(profileId, repositoryOverrides);
    const [fingerprint, plan] = await Promise.all([
      this.fingerprint(profileId, config, workflowRunId),
      Promise.resolve(compileEvidenceProfile(config, profileId)),
    ]);
    if (repositoryOverrides !== null) {
      const expectedHeads = new Map(
        repositoryOverrides.flatMap((repository) =>
          repository.head ? [[repository.repositoryId, repository.head] as const] : [],
        ),
      );
      for (const repository of fingerprint.manifest.repositories) {
        const expectedHead = expectedHeads.get(repository.repositoryId);
        if (
          (expectedHead && repository.head.toLowerCase() !== expectedHead.toLowerCase()) ||
          repository.dirtyFiles.length > 0
        ) {
          throw new Error(
            `Evidence repository override changed before execution: ${repository.repositoryId}`,
          );
        }
      }
    }
    return { config, plan, fingerprint };
  }

  async run(
    profileId: string,
    attemptId: string = randomUUID(),
    workflowRunId: string | null = null,
    signal?: AbortSignal,
  ): Promise<
    EvidenceRunResult & { gate: EvidenceGateProjection; telemetry: EvidenceTelemetryStatus }
  > {
    return this.runWithRepositories(profileId, [], attemptId, workflowRunId, signal, false);
  }

  async runForRepositories(
    profileId: string,
    repositories: EvidenceRepositoryOverride[],
    attemptId: string = randomUUID(),
    workflowRunId: string | null = null,
    signal?: AbortSignal,
  ): Promise<
    EvidenceRunResult & { gate: EvidenceGateProjection; telemetry: EvidenceTelemetryStatus }
  > {
    return this.runWithRepositories(
      profileId,
      repositories,
      attemptId,
      workflowRunId,
      signal,
      true,
    );
  }

  private async executeContext(
    context: EvidenceRunContext,
    config: EffectiveProjectConfig,
    signal: AbortSignal | undefined,
    completedStatus: Extract<EvidenceRunContext['status'], 'completed' | 'recovered'>,
  ): Promise<
    EvidenceRunResult & { gate: EvidenceGateProjection; telemetry: EvidenceTelemetryStatus }
  > {
    const artifacts = new FileArtifactStore(this.workspace);
    const adapters = this.ctx.evidenceAdapters.create(config, artifacts);
    const specification = this.ctx.get('specification');
    const inputProofs = new FileEvidenceInputProofs(config, context.plan, artifacts);
    let endingObservation:
      | Promise<Awaited<ReturnType<EvidenceCoordinator['planWithRepositories']>>>
      | undefined;
    const observeEnding = () =>
      (endingObservation ??= this.planWithRepositories(
        context.profileId,
        context.repositoryOverrides,
        context.workflowBinding?.workflowRunId,
      ));
    const candidates = await this.store.reusableReceipts(
      context.plan.nodes
        .filter((node) => node.type === 'command' && node.cache)
        .map((node) => node.id),
    );
    const reusableReceipts = [];
    for (const candidate of candidates) {
      const bundle = await this.store.findBundleByAttempt(candidate.attemptId);
      const check = bundle?.checks.find(
        (entry) => entry.receiptId === candidate.receiptId && entry.nodeId === candidate.nodeId,
      );
      // The immutable Receipt precedes ending-input validation. Its original
      // Bundle owns the later superseded conclusion for this particular node.
      if (!check || check.status !== 'passed' || check.freshness === 'superseded') continue;
      const entries = await this.journal.load(candidate.attemptId);
      if (
        entries.some(
          (entry) =>
            entry.type === 'node.completed' &&
            entry.nodeId === candidate.nodeId &&
            entry.receiptId === candidate.receiptId,
        )
      )
        reusableReceipts.push(candidate);
    }
    const result = await new EvidenceService(
      artifacts,
      this.store,
      adapters.command,
      undefined,
      this.journal,
      {
        ...adapters,
        ...(specification ? { specification } : {}),
      },
    ).run(context.plan, context.fingerprint.digest, {
      compositionDigest: this.ctx.compositionIdentity.current().compositionDigest,
      attemptId: context.attemptId,
      nodeInputs: context.fingerprint.manifest.nodeInputs,
      inputProofs,
      reusableReceipts,
      ...(signal ? { signal } : {}),
      ...(config.local?.resources?.maxParallel
        ? { maxParallel: config.local.resources.maxParallel }
        : {}),
      ...(config.local?.resources?.maxLogBytes
        ? { maxOutputBytes: config.local.resources.maxLogBytes }
        : {}),
      captureEndingFingerprint: async () => (await observeEnding()).fingerprint.digest,
      captureEndingNodeInputs: async () => (await observeEnding()).fingerprint.manifest.nodeInputs,
      ...(context.workflowBinding?.acceptanceContext
        ? { acceptanceContext: context.workflowBinding.acceptanceContext }
        : {}),
    });
    await atomicWriteJson(this.contextFile(context.attemptId), {
      ...context,
      status: completedStatus,
      bundleId: result.bundle.bundleId,
      decisionRequests: result.decisionRequests,
      updatedAt: new Date().toISOString(),
    } satisfies EvidenceRunContext);
    const gate = projectEvidenceGate(result.bundle, context.workflowBinding);
    await this.telemetryOutbox.save(
      createEvidenceTelemetryBatch({
        workflowRunId: context.workflowBinding?.workflowRunId ?? null,
        result,
        gate,
      }),
    );
    const telemetry = await this.flushTelemetry(context.attemptId);
    return { ...result, gate, telemetry };
  }

  private async runWithRepositories(
    profileId: string,
    repositories: EvidenceRepositoryOverride[],
    attemptId: string,
    workflowRunId: string | null,
    signal: AbortSignal | undefined,
    useOverrides: boolean,
  ): Promise<
    EvidenceRunResult & { gate: EvidenceGateProjection; telemetry: EvidenceTelemetryStatus }
  > {
    const attemptResource = `evidence-attempt:${attemptId}`;
    try {
      return await this.operations.run(
        { cancellable: true, signal },
        ({ signal: operationSignal, markDurableBoundary }) =>
          this.leases.withLease(attemptResource, () =>
            this.leases.withLease(`evidence-profile:${profileId}`, async () => {
              if (operationSignal.aborted) throw operationSignal.reason;
              if (await optional(() => this.loadContext(attemptId))) {
                throw new Error(`Evidence attempt already exists: ${attemptId}`);
              }
              const [binding, planned] = await Promise.all([
                this.workflowBinding(workflowRunId, profileId),
                this.planWithRepositories(
                  profileId,
                  useOverrides ? repositories : null,
                  workflowRunId,
                ),
              ]);
              const { config, plan, fingerprint } = planned;
              if (
                binding?.expectedEvidenceFingerprint &&
                binding.expectedEvidenceFingerprint !== fingerprint.digest
              ) {
                throw new Error(
                  `Verify Work input fingerprint changed before Evidence execution: ${profileId}`,
                );
              }
              const context: EvidenceRunContext = {
                schemaVersion: 2,
                kind: 'EvidenceRunContext',
                attemptId,
                profileId,
                repositoryOverrides: useOverrides ? structuredClone(repositories) : null,
                workflowBinding: binding,
                status: 'running',
                plan,
                fingerprint,
                bundleId: null,
                decisionRequests: [],
                updatedAt: new Date().toISOString(),
              };
              await atomicWriteJson(this.contextFile(attemptId), context);
              markDurableBoundary();
              return this.executeContext(context, config, operationSignal, 'completed');
            }),
          ),
      );
    } catch (error) {
      if (
        error instanceof ResourceLeaseConflictError &&
        error.owner.resourceKey === attemptResource
      ) {
        throw new Error(`Evidence attempt already exists: ${attemptId}`, { cause: error });
      }
      throw error;
    }
  }

  async status(attemptId: string): Promise<EvidenceStatus> {
    const context = await this.loadContext(attemptId);
    const [attempt, bundle] = await Promise.all([
      this.store.loadAttempt(attemptId),
      context.bundleId ? this.store.loadBundle(context.bundleId) : Promise.resolve(null),
    ]);
    if (bundle) {
      if (
        bundle.attemptId !== context.attemptId ||
        bundle.profileId !== context.profileId ||
        bundle.inputFingerprint !== context.fingerprint.digest ||
        bundle.compositionDigest !== attempt.compositionDigest ||
        JSON.stringify(bundle.receiptIds) !== JSON.stringify(attempt.receiptIds)
      )
        throw new Error('Evidence Bundle does not match its frozen Attempt');
      const receipts = await Promise.all(bundle.receiptIds.map((id) => this.store.loadReceipt(id)));
      for (const receipt of receipts) {
        const snapshot = context.fingerprint.manifest.nodeInputs.find(
          (entry) => entry.nodeId === receipt.nodeId,
        );
        if (
          !snapshot ||
          !evidenceReceiptInputCurrent(receipt, snapshot, receipts) ||
          receipt.attemptId !== context.attemptId
        )
          throw new Error('Persisted Receipt does not prove the frozen node inputs');
      }
      if (
        JSON.stringify(bundle.checks.map((check) => check.nodeId)) !==
        JSON.stringify(context.plan.order)
      )
        throw new Error('Evidence Bundle does not match its frozen DAG');
      if (context.workflowBinding?.acceptanceContext) {
        const expected = createAcceptanceTrace({
          context: context.workflowBinding.acceptanceContext,
          checks: bundle.checks,
          receipts,
          inputFingerprint: bundle.inputFingerprint,
          nodeInputs: context.fingerprint.manifest.nodeInputs,
        });
        if (evidenceInputDigest(expected) !== evidenceInputDigest(bundle.acceptanceTrace))
          throw new Error('Persisted Acceptance Trace does not match its Receipt proof');
      }
    }
    return {
      context,
      attempt,
      bundle,
      gate: bundle ? projectEvidenceGate(bundle, context.workflowBinding) : null,
    };
  }

  async resume(attemptId: string, signal?: AbortSignal): Promise<EvidenceStatus> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.leases.withLease(`evidence-attempt:${attemptId}`, async () => {
        const discovered = await this.loadContext(attemptId);
        return this.leases.withLease(`evidence-profile:${discovered.profileId}`, async () => {
          const context = await this.loadContext(attemptId);
          if (context.status !== 'running') {
            await this.flushTelemetry(attemptId);
            return this.status(attemptId);
          }
          const attempt = await optional(() => this.store.loadAttempt(attemptId));
          if (!attempt) {
            const [entries, bundle] = await Promise.all([
              this.journal.load(attemptId),
              this.store.findBundleByAttempt(attemptId),
            ]);
            if (entries.length > 0 || bundle || context.bundleId) {
              throw new Error(
                `Evidence attempt is missing but durable execution facts exist: ${attemptId}`,
              );
            }
            const config = await this.effectiveConfig(
              context.profileId,
              context.repositoryOverrides,
            );
            const currentFingerprint = await this.fingerprint(
              context.profileId,
              config,
              context.workflowBinding?.workflowRunId,
            );
            if (currentFingerprint.digest !== context.fingerprint.digest) {
              throw new Error(
                `Verify Work input fingerprint changed before Evidence execution: ${context.profileId}`,
              );
            }
            await this.executeContext(context, config, signal, 'recovered');
            return this.status(attemptId);
          }
          let recovered;
          if (attempt.status === 'running') {
            const config = await this.effectiveConfig(
              context.profileId,
              context.repositoryOverrides,
            );
            const endingFingerprint = await this.fingerprint(
              context.profileId,
              config,
              context.workflowBinding?.workflowRunId,
            );
            recovered = await recoverEvidenceAttempt({
              attemptId,
              plan: context.plan,
              store: this.store,
              journal: this.journal,
              timestamp: new Date().toISOString(),
              endingFingerprint: endingFingerprint.digest,
              nodeInputs: context.fingerprint.manifest.nodeInputs,
              endingNodeInputs: endingFingerprint.manifest.nodeInputs,
              inputProofs: new FileEvidenceInputProofs(
                config,
                context.plan,
                new FileArtifactStore(this.workspace),
              ),
              artifacts: new FileArtifactStore(this.workspace),
              ...(context.workflowBinding?.acceptanceContext
                ? { acceptanceContext: context.workflowBinding.acceptanceContext }
                : {}),
            });
          } else {
            const bundle = await this.store.findBundleByAttempt(attemptId);
            if (bundle) {
              recovered = {
                bundle,
                receipts: await Promise.all(
                  bundle.receiptIds.map((receiptId) => this.store.loadReceipt(receiptId)),
                ),
              };
            } else {
              const config = await this.effectiveConfig(
                context.profileId,
                context.repositoryOverrides,
              );
              const endingFingerprint = await this.fingerprint(
                context.profileId,
                config,
                context.workflowBinding?.workflowRunId,
              );
              recovered = await recoverEvidenceAttempt({
                attemptId,
                plan: context.plan,
                store: this.store,
                journal: this.journal,
                timestamp: new Date().toISOString(),
                endingFingerprint: endingFingerprint.digest,
                nodeInputs: context.fingerprint.manifest.nodeInputs,
                endingNodeInputs: endingFingerprint.manifest.nodeInputs,
                inputProofs: new FileEvidenceInputProofs(
                  config,
                  context.plan,
                  new FileArtifactStore(this.workspace),
                ),
                artifacts: new FileArtifactStore(this.workspace),
                allowTerminalAttempt: true,
                ...(context.workflowBinding?.acceptanceContext
                  ? { acceptanceContext: context.workflowBinding.acceptanceContext }
                  : {}),
              });
            }
          }
          await atomicWriteJson(this.contextFile(attemptId), {
            ...context,
            status: 'recovered',
            bundleId: recovered.bundle.bundleId,
            updatedAt: new Date().toISOString(),
          } satisfies EvidenceRunContext);
          const recoveredAttempt = await this.store.loadAttempt(attemptId);
          const result: EvidenceRunResult = {
            attempt: recoveredAttempt,
            ...recovered,
            decisionRequests: [],
          };
          await this.telemetryOutbox.save(
            createEvidenceTelemetryBatch({
              workflowRunId: context.workflowBinding?.workflowRunId ?? null,
              result,
              gate: projectEvidenceGate(recovered.bundle, context.workflowBinding),
            }),
          );
          await this.flushTelemetry(attemptId);
          return this.status(attemptId);
        });
      }),
    );
  }

  async runOrResume(
    profileId: string,
    attemptId: string,
    workflowRunId: string,
    signal?: AbortSignal,
  ): Promise<EvidenceStatus> {
    const existing = await this.lookup(attemptId);
    if (existing) {
      this.assertRunOwner(existing.context, profileId, workflowRunId);
      return this.resume(attemptId, signal);
    }
    try {
      await this.run(profileId, attemptId, workflowRunId, signal);
      return this.status(attemptId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!reason.includes(`Evidence attempt already exists: ${attemptId}`)) throw error;
      this.assertRunOwner(await this.loadContext(attemptId), profileId, workflowRunId);
      return this.resume(attemptId, signal);
    }
  }

  async evaluate(input: {
    workflowRunId: string;
    workflowActionId: string;
    workflowStepId: string;
    workflowStateVersion?: number;
    checkEpoch?: number;
    profileId: string;
    attemptId: string;
  }): Promise<EvidenceGateProjection> {
    const status = await this.status(input.attemptId);
    if (!status.bundle) {
      throw new Error(`Evidence attempt has no completed bundle: ${input.attemptId}`);
    }
    const gate = projectEvidenceGate(status.bundle, status.context.workflowBinding);
    const binding = status.context.workflowBinding;
    if (binding?.workflowRunId !== input.workflowRunId) {
      return {
        ...gate,
        status: 'blocked',
        failureKind: 'unavailable',
        reason: `Evidence attempt ${input.attemptId} belongs to a different workflow run`,
      };
    }
    if (binding.workflowActionId !== input.workflowActionId) {
      return {
        ...gate,
        status: 'blocked',
        failureKind: 'unavailable',
        reason: `Evidence attempt ${input.attemptId} belongs to a different workflow action`,
      };
    }
    if (binding.workflowStepId !== input.workflowStepId) {
      return {
        ...gate,
        status: 'blocked',
        failureKind: 'unavailable',
        reason: `Evidence attempt ${input.attemptId} belongs to a different workflow step`,
      };
    }
    if (
      (input.checkEpoch !== undefined && binding.checkEpoch !== input.checkEpoch) ||
      (input.checkEpoch === undefined &&
        binding.workflowStateVersion !== input.workflowStateVersion)
    ) {
      return {
        ...gate,
        status: 'blocked',
        failureKind: 'unavailable',
        reason: `Evidence attempt ${input.attemptId} belongs to a stale lifecycle fence`,
      };
    }
    if (status.context.profileId !== input.profileId) {
      return {
        ...gate,
        status: 'blocked',
        failureKind: 'unavailable',
        reason: `Evidence attempt ${input.attemptId} uses profile ${status.context.profileId}`,
      };
    }
    const assessment = await this.assessInputs(input.attemptId, input.workflowRunId);
    if (assessment !== 'same')
      return {
        ...gate,
        status: 'blocked',
        failureKind: 'input-drift',
        reason: `Evidence input fingerprint changed after attempt ${input.attemptId}`,
      };
    return gate;
  }

  async assessInputs(attemptId: string, workflowRunId: string): Promise<'same' | 'drift'> {
    const status = await this.status(attemptId);
    if (status.context.workflowBinding?.workflowRunId !== workflowRunId || !status.bundle) {
      throw new Error('Evidence input observation requires the owning Run and completed Bundle');
    }
    const config = await this.effectiveConfig(
      status.context.profileId,
      status.context.repositoryOverrides,
    );
    const current = await this.fingerprint(status.context.profileId, config, workflowRunId);
    if (current.digest !== status.bundle.inputFingerprint) {
      return 'drift';
    }
    const receipts = await Promise.all(
      status.bundle.receiptIds.map((id) => this.store.loadReceipt(id)),
    );
    const proofs = new FileEvidenceInputProofs(
      config,
      status.context.plan,
      new FileArtifactStore(this.workspace),
    );
    for (const receipt of receipts) {
      const snapshot = status.context.fingerprint.manifest.nodeInputs.find(
        (entry) => entry.nodeId === receipt.nodeId,
      );
      if (!snapshot || !evidenceReceiptInputCurrent(receipt, snapshot, receipts)) {
        throw new Error('Evidence node dependency proof is invalid');
      }
      if (snapshot.derivedFrom.length) {
        let observed;
        try {
          observed = await proofs.captureDerived(
            snapshot,
            new Map(receipts.map((entry) => [entry.nodeId, entry])),
          );
        } catch (error) {
          if (error instanceof EvidenceInputDriftError) return 'drift';
          throw error;
        }
        if (JSON.stringify(observed) !== JSON.stringify(receipt.derivedInputs)) {
          return 'drift';
        }
      }
      if (receipt.status === 'passed' && !(await proofs.outputsCurrent(snapshot, receipt)))
        return 'drift';
    }
    return 'same';
  }

  async assessBundleInputs(
    bundleId: string,
    workflowRunId: string,
    verificationInputDigest: string,
  ): Promise<'same' | 'drift'> {
    const bundle = await this.store.loadBundle(bundleId);
    if (bundle.acceptanceTrace?.verificationInputDigest !== verificationInputDigest)
      throw new Error('Archive Evidence Bundle does not match its frozen Verification Input');
    return this.assessInputs(bundle.attemptId, workflowRunId);
  }

  async flushTelemetry(attemptId: string): Promise<EvidenceTelemetryStatus> {
    const [batch, cursor] = await Promise.all([
      this.telemetryOutbox.load(attemptId),
      this.telemetryOutbox.readCursor(attemptId),
    ]);
    if (!batch) return { status: 'not_ready', exportedEvents: 0 };
    const events = batch.events.filter((event) => event.sequence > cursor.offset);
    if (events.length === 0) return { status: 'exported', exportedEvents: 0 };
    try {
      await this.telemetry.export({ ...batch, events });
      const last = events.at(-1)!;
      await this.telemetryOutbox.writeCursor({
        schemaVersion: 1,
        attemptId,
        offset: last.sequence,
        updatedAt: new Date().toISOString(),
      });
      return { status: 'exported', exportedEvents: events.length };
    } catch (error) {
      return {
        status: 'pending',
        exportedEvents: 0,
        diagnostic: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async inspect(
    attemptId: string,
  ): Promise<EvidenceStatus & { journal: Awaited<ReturnType<FileEvidenceJournal['load']>> }> {
    const [status, journal] = await Promise.all([
      this.status(attemptId),
      this.journal.load(attemptId),
    ]);
    return { ...status, journal };
  }

  private async contexts(): Promise<EvidenceRunContext[]> {
    const directory = path.dirname(this.contextFile('placeholder'));
    const entries = await optional(() => readdir(directory, { withFileTypes: true }));
    if (!entries) return [];
    return Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json'),
        )
        .map(async (entry) =>
          asContext(
            JSON.parse(await readFile(path.join(directory, entry.name), 'utf8')) as unknown,
          ),
        ),
    );
  }

  async clean(options: { maxAgeMs: number; maxBytes: number }): Promise<EvidenceCleanupResult> {
    const config = await loadProjectConfig(this.workspace);
    const contexts = await this.contexts();
    const completed = (
      await Promise.all(
        contexts
          .filter((context) => context.bundleId)
          .map(async (context) => ({
            context,
            bundle: await this.store.loadBundle(context.bundleId!),
          })),
      )
    ).sort((left, right) => right.bundle.createdAt.localeCompare(left.bundle.createdAt));
    const keepSuccesses = config.shared.evidence?.retention?.minRecentSuccesses ?? 1;
    const recentSuccessBundleIds: string[] = [];
    const successCounts = new Map<string, number>();
    for (const { context, bundle } of completed) {
      if (bundle.outcome !== 'passed' && bundle.outcome !== 'passed_with_warnings') continue;
      const group = `${context.workflowBinding?.workflowRunId ?? 'standalone'}\0${context.profileId}`;
      const count = successCounts.get(group) ?? 0;
      if (count >= keepSuccesses) continue;
      successCounts.set(group, count + 1);
      recentSuccessBundleIds.push(bundle.bundleId);
    }
    const approvedBundleIds = await new FileDeliveryStore(
      this.workspace,
    ).approvedEvidenceBundleIds();
    const runtimeRetention = await this.ctx.runStore.evidenceRetentionState();
    return new FileEvidenceRetention(this.workspace).cleanup({
      roots: {
        activeAttemptIds: contexts
          .filter((context) => context.status === 'running')
          .map((context) => context.attemptId),
        acceptedBundleIds: runtimeRetention.acceptedBundleIds,
        approvedBundleIds,
        recentSuccessBundleIds,
        failureBundleIds: completed
          .filter(({ bundle }) => bundle.outcome === 'failed' || bundle.outcome === 'incomplete')
          .map(({ bundle }) => bundle.bundleId),
      },
      maxAgeMs: options.maxAgeMs,
      maxBytes: options.maxBytes,
      defer: runtimeRetention.deferred,
    });
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evidenceCoordinator: EvidenceCoordinator;
  }
}
