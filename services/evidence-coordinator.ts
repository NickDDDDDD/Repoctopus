import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createEvidenceFingerprint,
  type EvidenceFingerprint,
} from '../domains/evidence/fingerprint.js';
import { projectEvidenceGate } from '../domains/evidence/gate.js';
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
import {
  FileEvidenceRetention,
  type EvidenceCleanupResult,
} from '../platform/evidence/retention.js';
import { collectRepositoryFingerprint } from '../platform/git/evidence-fingerprint.js';
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
  schemaVersion: 1;
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
  if (fingerprintSchema !== undefined && fingerprintSchema !== 2) {
    throw new Error(
      `Unsupported Evidence fingerprint schema: ${String(fingerprintSchema)}; recollect Evidence`,
    );
  }
  const binding = record?.workflowBinding;
  if (
    !record ||
    typeof record !== 'object' ||
    record.schemaVersion !== 1 ||
    record.kind !== 'EvidenceRunContext' ||
    typeof record.attemptId !== 'string' ||
    typeof record.profileId !== 'string' ||
    !record.fingerprint ||
    fingerprintSchema !== 2 ||
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
    return createEvidenceFingerprint({
      schemaVersion: 2,
      profileId,
      sharedConfigDigest: config.sharedDigest,
      localConfigDigest: config.localDigest,
      repositories,
      tools: { node: process.version },
      adapters: {
        command: 'local/v2',
        service: 'local/v1',
        browser: 'playwright-core/v2',
        visual: hasVisualAdapter ? 'file-exchange-or-provided/v1' : 'unavailable/v1',
      },
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

  async plan(profileId: string): Promise<{
    plan: EvidenceExecutionPlan;
    fingerprint: EvidenceFingerprint;
  }> {
    return this.planWithRepositories(profileId, null);
  }

  private async planWithRepositories(
    profileId: string,
    repositoryOverrides: readonly EvidenceRepositoryOverride[] | null,
  ): Promise<{
    config: EffectiveProjectConfig;
    plan: EvidenceExecutionPlan;
    fingerprint: EvidenceFingerprint;
  }> {
    const config = await this.effectiveConfig(profileId, repositoryOverrides);
    const [fingerprint, plan] = await Promise.all([
      this.fingerprint(profileId, config),
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
      ...(signal ? { signal } : {}),
      ...(config.local?.resources?.maxParallel
        ? { maxParallel: config.local.resources.maxParallel }
        : {}),
      ...(config.local?.resources?.maxLogBytes
        ? { maxOutputBytes: config.local.resources.maxLogBytes }
        : {}),
      captureEndingFingerprint: async () =>
        (await this.fingerprint(context.profileId, config)).digest,
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
                this.planWithRepositories(profileId, useOverrides ? repositories : null),
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
                schemaVersion: 1,
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
            const currentFingerprint = await this.fingerprint(context.profileId, config);
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
            const endingFingerprint = await this.fingerprint(context.profileId, config);
            recovered = await recoverEvidenceAttempt({
              attemptId,
              plan: context.plan,
              store: this.store,
              journal: this.journal,
              timestamp: new Date().toISOString(),
              endingFingerprint: endingFingerprint.digest,
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
              const endingFingerprint = await this.fingerprint(context.profileId, config);
              recovered = await recoverEvidenceAttempt({
                attemptId,
                plan: context.plan,
                store: this.store,
                journal: this.journal,
                timestamp: new Date().toISOString(),
                endingFingerprint: endingFingerprint.digest,
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
        reason: `Evidence attempt ${input.attemptId} belongs to a different workflow run`,
      };
    }
    if (binding.workflowActionId !== input.workflowActionId) {
      return {
        ...gate,
        status: 'blocked',
        reason: `Evidence attempt ${input.attemptId} belongs to a different workflow action`,
      };
    }
    if (binding.workflowStepId !== input.workflowStepId) {
      return {
        ...gate,
        status: 'blocked',
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
        reason: `Evidence attempt ${input.attemptId} belongs to a stale lifecycle fence`,
      };
    }
    if (status.context.profileId !== input.profileId) {
      return {
        ...gate,
        status: 'blocked',
        reason: `Evidence attempt ${input.attemptId} uses profile ${status.context.profileId}`,
      };
    }
    const config = await this.effectiveConfig(
      status.context.profileId,
      status.context.repositoryOverrides,
    );
    const current = await this.fingerprint(input.profileId, config);
    if (current.digest !== status.bundle.inputFingerprint) {
      return {
        ...gate,
        status: 'blocked',
        reason: `Evidence input fingerprint changed after attempt ${input.attemptId}`,
      };
    }
    return gate;
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
