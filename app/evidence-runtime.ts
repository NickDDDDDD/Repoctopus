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
import type {
  EvidenceAttempt,
  EvidenceBundle,
  EvidenceGateProjection,
} from '../domains/evidence/types.js';
import { compileEvidenceProfile, type EvidenceExecutionPlan } from '../domains/feedback/profile.js';
import { atomicWriteJson } from '../platform/filesystem/atomic-write.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceJournal } from '../platform/evidence/file-evidence-journal.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import {
  FileEvidenceRetention,
  type EvidenceCleanupResult,
} from '../platform/evidence/retention.js';
import { LocalCommandAdapter } from '../platform/feedback/command-adapter.js';
import { collectRepositoryFingerprint } from '../platform/git/evidence-fingerprint.js';
import { loadProjectConfig } from '../platform/project-configuration/file-config.js';
import { FileResourceLeaseManager } from '../platform/runtime/resource-lease.js';

interface EvidenceRunContext {
  schemaVersion: 1;
  kind: 'EvidenceRunContext';
  attemptId: string;
  profileId: string;
  status: 'running' | 'completed' | 'recovered';
  plan: EvidenceExecutionPlan;
  fingerprint: EvidenceFingerprint;
  bundleId: string | null;
  updatedAt: string;
}

export interface EvidenceStatus {
  context: EvidenceRunContext;
  attempt: EvidenceAttempt;
  bundle: EvidenceBundle | null;
  gate: EvidenceGateProjection | null;
}

function asContext(value: unknown): EvidenceRunContext {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (value as { kind?: unknown }).kind !== 'EvidenceRunContext'
  ) {
    throw new Error('Invalid EvidenceRunContext');
  }
  return value as EvidenceRunContext;
}

async function optional<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class EvidenceRuntime {
  private readonly store: FileEvidenceStore;
  private readonly journal: FileEvidenceJournal;
  private readonly leases: FileResourceLeaseManager;

  constructor(private readonly workspace: string) {
    this.workspace = path.resolve(workspace);
    this.store = new FileEvidenceStore(this.workspace);
    this.journal = new FileEvidenceJournal(this.workspace);
    this.leases = new FileResourceLeaseManager(this.workspace);
  }

  private contextFile(attemptId: string): string {
    return path.join(this.workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
  }

  private async loadContext(attemptId: string): Promise<EvidenceRunContext> {
    return asContext(JSON.parse(await readFile(this.contextFile(attemptId), 'utf8')) as unknown);
  }

  private async fingerprint(profileId: string): Promise<EvidenceFingerprint> {
    const config = await loadProjectConfig(this.workspace);
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
      adapters: { command: 'local/v1' },
      inputArtifactDigests: [],
    });
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
  ): Promise<EvidenceRunResult & { gate: EvidenceGateProjection }> {
    return this.leases.withLease(`evidence-profile:${profileId}`, async () => {
      const { plan, fingerprint } = await this.plan(profileId);
      const context: EvidenceRunContext = {
        schemaVersion: 1,
        kind: 'EvidenceRunContext',
        attemptId,
        profileId,
        status: 'running',
        plan,
        fingerprint,
        bundleId: null,
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteJson(this.contextFile(attemptId), context);
      const result = await new EvidenceService(
        new FileArtifactStore(this.workspace),
        this.store,
        new LocalCommandAdapter(),
        undefined,
        this.journal,
      ).run(plan, fingerprint.digest, {
        attemptId,
        captureEndingFingerprint: async () => (await this.fingerprint(profileId)).digest,
      });
      await atomicWriteJson(this.contextFile(attemptId), {
        ...context,
        status: 'completed',
        bundleId: result.bundle.bundleId,
        updatedAt: new Date().toISOString(),
      } satisfies EvidenceRunContext);
      return { ...result, gate: projectEvidenceGate(result.bundle) };
    });
  }

  async status(attemptId: string): Promise<EvidenceStatus> {
    const context = await this.loadContext(attemptId);
    const [attempt, bundle] = await Promise.all([
      this.store.loadAttempt(attemptId),
      context.bundleId ? this.store.loadBundle(context.bundleId) : Promise.resolve(null),
    ]);
    return { context, attempt, bundle, gate: bundle ? projectEvidenceGate(bundle) : null };
  }

  async resume(attemptId: string): Promise<EvidenceStatus> {
    return this.leases.withLease(`evidence-profile-recovery:${attemptId}`, async () => {
      const context = await this.loadContext(attemptId);
      if (context.status !== 'running') return this.status(attemptId);
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
      return this.status(attemptId);
    });
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
    const recentSuccessBundleIds = completed
      .filter(
        ({ bundle }) => bundle.outcome === 'passed' || bundle.outcome === 'passed_with_warnings',
      )
      .slice(0, keepSuccesses)
      .map(({ bundle }) => bundle.bundleId);
    return new FileEvidenceRetention(this.workspace).cleanup({
      roots: {
        activeAttemptIds: contexts
          .filter((context) => context.status === 'running')
          .map((context) => context.attemptId),
        approvedBundleIds: [],
        recentSuccessBundleIds,
        failureBundleIds: completed
          .filter(({ bundle }) => bundle.outcome === 'failed' || bundle.outcome === 'incomplete')
          .map(({ bundle }) => bundle.bundleId),
      },
      maxAgeMs: options.maxAgeMs,
      maxBytes: options.maxBytes,
    });
  }
}
