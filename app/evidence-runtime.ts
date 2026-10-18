import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

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
  EvidenceBundle,
  EvidenceGateProjection,
} from '../domains/evidence/types.js';
import type { EvidenceGatePort } from '../domains/runtime/types.js';
import { compileEvidenceProfile, type EvidenceExecutionPlan } from '../domains/feedback/profile.js';
import type { VisualInspectionAdapter } from '../domains/feedback/visual.js';
import type { RequirementsConflictDecisionRequest } from '../domains/feedback/visual.js';
import { LocalBrowserAdapter } from '../platform/browser/browser-adapter.js';
import { atomicWriteJson } from '../platform/filesystem/atomic-write.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import { FileEvidenceJournal } from '../platform/evidence/file-evidence-journal.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import {
  FileEvidenceRetention,
  type EvidenceCleanupResult,
} from '../platform/evidence/retention.js';
import { LocalCommandAdapter } from '../platform/feedback/command-adapter.js';
import { LocalServiceAdapter } from '../platform/feedback/service-adapter.js';
import { FileExchangeVisualInspectionAdapter } from '../platform/feedback/file-exchange-visual-adapter.js';
import { collectRepositoryFingerprint } from '../platform/git/evidence-fingerprint.js';
import { loadProjectConfig } from '../platform/project-configuration/file-config.js';
import { FileResourceLeaseManager } from '../platform/runtime/resource-lease.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { FileEvidenceTelemetryOutbox } from '../platform/telemetry/evidence-outbox.js';

interface WorkflowEvidenceBinding {
  workflowRunId: string;
  workflowActionId: string;
  workflowStepId: string;
  workflowStateVersion: number;
}

interface EvidenceRunContext {
  schemaVersion: 1;
  kind: 'EvidenceRunContext';
  attemptId: string;
  profileId: string;
  workflowBinding: WorkflowEvidenceBinding | null;
  status: 'running' | 'completed' | 'recovered';
  plan: EvidenceExecutionPlan;
  fingerprint: EvidenceFingerprint;
  bundleId: string | null;
  decisionRequests: RequirementsConflictDecisionRequest[];
  updatedAt: string;
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
  const binding = record?.workflowBinding;
  if (
    !record ||
    typeof record !== 'object' ||
    record.schemaVersion !== 1 ||
    record.kind !== 'EvidenceRunContext' ||
    typeof record.attemptId !== 'string' ||
    typeof record.profileId !== 'string' ||
    !['running', 'completed', 'recovered'].includes(record.status ?? '') ||
    (binding !== null &&
      (!binding ||
        typeof binding.workflowRunId !== 'string' ||
        typeof binding.workflowActionId !== 'string' ||
        typeof binding.workflowStepId !== 'string' ||
        !Number.isSafeInteger(binding.workflowStateVersion) ||
        binding.workflowStateVersion < 0))
  ) {
    throw new Error('Invalid EvidenceRunContext');
  }
  return record as EvidenceRunContext;
}

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class EvidenceRuntime implements EvidenceGatePort {
  private readonly store: FileEvidenceStore;
  private readonly journal: FileEvidenceJournal;
  private readonly leases: FileResourceLeaseManager;
  private readonly telemetryOutbox: FileEvidenceTelemetryOutbox;

  constructor(
    private readonly workspace: string,
    private readonly telemetry: EvidenceTelemetryPort = { async export() {} },
    private readonly visual?: VisualInspectionAdapter,
  ) {
    this.workspace = path.resolve(workspace);
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

  private async fingerprint(profileId: string): Promise<EvidenceFingerprint> {
    const config = await loadProjectConfig(this.workspace);
    const hasVisualAdapter = this.visual !== undefined || config.local?.visual !== undefined;
    const repositories = await Promise.all(
      config.repositories.map((repository) =>
        collectRepositoryFingerprint({
          repositoryId: repository.id,
          root: repository.resolvedPath,
        }),
      ),
    );
    return createEvidenceFingerprint({
      schemaVersion: 1,
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
    const runtimeStore = new FileRuntimeStore(this.workspace);
    const [state, workflow] = await Promise.all([
      runtimeStore.loadRun(workflowRunId),
      runtimeStore.loadWorkflow(workflowRunId),
    ]);
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
    const config = await loadProjectConfig(this.workspace);
    const [fingerprint, plan] = await Promise.all([
      this.fingerprint(profileId),
      Promise.resolve(compileEvidenceProfile(config, profileId)),
    ]);
    return { plan, fingerprint };
  }

  async run(
    profileId: string,
    attemptId: string = randomUUID(),
    workflowRunId: string | null = null,
  ): Promise<
    EvidenceRunResult & { gate: EvidenceGateProjection; telemetry: EvidenceTelemetryStatus }
  > {
    return this.leases.withLease(`evidence-profile:${profileId}`, async () => {
      const [binding, planned] = await Promise.all([
        this.workflowBinding(workflowRunId, profileId),
        this.plan(profileId),
      ]);
      const { plan, fingerprint } = planned;
      const config = await loadProjectConfig(this.workspace);
      const visual =
        this.visual ??
        (config.local?.visual
          ? new FileExchangeVisualInspectionAdapter(this.workspace, config.local.visual)
          : undefined);
      const artifacts = new FileArtifactStore(this.workspace);
      const context: EvidenceRunContext = {
        schemaVersion: 1,
        kind: 'EvidenceRunContext',
        attemptId,
        profileId,
        workflowBinding: binding,
        status: 'running',
        plan,
        fingerprint,
        bundleId: null,
        decisionRequests: [],
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteJson(this.contextFile(attemptId), context);
      const result = await new EvidenceService(
        artifacts,
        this.store,
        new LocalCommandAdapter(),
        undefined,
        this.journal,
        {
          services: new LocalServiceAdapter(this.workspace),
          browser: new LocalBrowserAdapter(this.workspace, artifacts, {
            ...(config.local?.browser?.executablePath
              ? { configuredExecutablePath: config.local.browser.executablePath }
              : {}),
          }),
          ...(visual ? { visual } : {}),
        },
      ).run(plan, fingerprint.digest, {
        attemptId,
        ...(config.local?.resources?.maxParallel
          ? { maxParallel: config.local.resources.maxParallel }
          : {}),
        ...(config.local?.resources?.maxLogBytes
          ? { maxOutputBytes: config.local.resources.maxLogBytes }
          : {}),
        captureEndingFingerprint: async () => (await this.fingerprint(profileId)).digest,
      });
      await atomicWriteJson(this.contextFile(attemptId), {
        ...context,
        status: 'completed',
        bundleId: result.bundle.bundleId,
        decisionRequests: result.decisionRequests,
        updatedAt: new Date().toISOString(),
      } satisfies EvidenceRunContext);
      const gate = projectEvidenceGate(result.bundle, binding);
      await this.telemetryOutbox.save(
        createEvidenceTelemetryBatch({
          workflowRunId: binding?.workflowRunId ?? null,
          result,
          gate,
        }),
      );
      const telemetry = await this.flushTelemetry(attemptId);
      return { ...result, gate, telemetry };
    });
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

  async resume(attemptId: string): Promise<EvidenceStatus> {
    return this.leases.withLease(`evidence-profile-recovery:${attemptId}`, async () => {
      const context = await this.loadContext(attemptId);
      if (context.status !== 'running') {
        await this.flushTelemetry(attemptId);
        return this.status(attemptId);
      }
      const endingFingerprint = await this.fingerprint(context.profileId);
      const recovered = await recoverEvidenceAttempt({
        attemptId,
        plan: context.plan,
        store: this.store,
        journal: this.journal,
        timestamp: new Date().toISOString(),
        endingFingerprint: endingFingerprint.digest,
      });
      await atomicWriteJson(this.contextFile(attemptId), {
        ...context,
        status: 'recovered',
        bundleId: recovered.bundle.bundleId,
        updatedAt: new Date().toISOString(),
      } satisfies EvidenceRunContext);
      const attempt = await this.store.loadAttempt(attemptId);
      const result: EvidenceRunResult = { attempt, ...recovered, decisionRequests: [] };
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
  }

  async evaluate(input: {
    workflowRunId: string;
    workflowActionId: string;
    workflowStepId: string;
    workflowStateVersion: number;
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
    if (binding.workflowStateVersion !== input.workflowStateVersion) {
      return {
        ...gate,
        status: 'blocked',
        reason: `Evidence attempt ${input.attemptId} belongs to a stale workflow state`,
      };
    }
    if (status.context.profileId !== input.profileId) {
      return {
        ...gate,
        status: 'blocked',
        reason: `Evidence attempt ${input.attemptId} uses profile ${status.context.profileId}`,
      };
    }
    const current = await this.fingerprint(input.profileId);
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
    const runtimeRetention = await new FileRuntimeStore(this.workspace).evidenceRetentionState();
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
