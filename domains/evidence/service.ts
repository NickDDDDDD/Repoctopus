import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  ArtifactStore,
  EvidenceJournal,
  EvidenceStore,
  EvidenceInputProofPort,
} from './ports.js';
import { createEvidenceReceipt, type EvidenceReceiptFacts } from './receipt.js';
import { createEvidenceDependencyRecord, invalidateEvidenceDependencies } from './dependencies.js';
import { evidenceInputDigest, type EvidenceNodeInputSnapshot } from './input-snapshot.js';
import type { BrowserAdapter, BrowserJourneyResult } from '../feedback/browser.js';
import type { CommandAdapter } from '../feedback/ports.js';
import type { EvidenceExecutionPlan, PlannedEvidenceNode } from '../feedback/profile.js';
import type {
  ManagedServiceSession,
  ServiceAdapter,
  ServiceObservation,
} from '../feedback/service.js';
import {
  collectVisualInspection,
  conflictDecisionsFromVisualResponse,
  createVisualInspectionRequest,
  type RequirementsConflictDecisionRequest,
  type VisualInspectionAdapter,
} from '../feedback/visual.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { createEvidenceBundle } from './gate.js';
import { createAcceptanceTrace } from './acceptance-trace.js';
import { canReuseReceipt, reuseReceipt } from './lifecycle.js';
import { redactEvidenceText } from './redaction.js';
import { parseTestExecution } from './test-output.js';
import {
  EVIDENCE_API_VERSION,
  type ArtifactRef,
  type EvidenceAttempt,
  type EvidenceAcceptanceContext,
  type EvidenceBundle,
  type EvidenceCheck,
  type EvidenceFinding,
  type EvidenceReceipt,
} from './types.js';
import type { SpecificationValidation } from '../specification/types.js';
import { createVerificationReport } from './verification-report.js';

export interface EvidenceRunResult {
  attempt: EvidenceAttempt;
  receipts: EvidenceReceipt[];
  bundle: EvidenceBundle;
  decisionRequests: RequirementsConflictDecisionRequest[];
}

export interface EvidenceRunOptions {
  compositionDigest: string;
  signal?: AbortSignal;
  attemptId?: string;
  reusableReceipts?: readonly EvidenceReceipt[];
  captureEndingFingerprint?: () => Promise<string>;
  captureEndingNodeInputs?: () => Promise<readonly EvidenceNodeInputSnapshot[]>;
  maxOutputBytes?: number;
  sensitiveValues?: readonly string[];
  redactionPatterns?: readonly RegExp[];
  afterNodeCommitted?: (receipt: EvidenceReceipt) => void | Promise<void>;
  maxParallel?: number;
  acceptanceContext?: EvidenceAcceptanceContext;
  nodeInputs?: readonly EvidenceNodeInputSnapshot[];
  inputProofs?: EvidenceInputProofPort;
  /** Internal execution context, populated from the frozen node snapshot and predecessor receipts. */
  nodeSnapshot?: EvidenceNodeInputSnapshot;
  predecessorReceipts?: ReadonlyMap<string, EvidenceReceipt>;
  derivedInputs?: EvidenceReceipt['derivedInputs'];
}

export interface EvidenceClock {
  now(): Date;
}

export interface EvidenceAdapters {
  services?: ServiceAdapter;
  browser?: BrowserAdapter;
  visual?: VisualInspectionAdapter;
  specification?: {
    validate(
      changeId: string,
      options?: { strict?: boolean; signal?: AbortSignal },
    ): Promise<SpecificationValidation>;
  };
}

interface NodeExecution {
  receipt: EvidenceReceipt;
  managedSession?: ManagedServiceSession;
  decisionRequests?: RequirementsConflictDecisionRequest[];
}

const systemClock: EvidenceClock = { now: () => new Date() };

function resolveNodeCwd(repositoryPath: string, configuredCwd?: string): string {
  const resolved = path.resolve(repositoryPath, configuredCwd ?? '.');
  const relative = path.relative(repositoryPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Node cwd escapes repository: ${configuredCwd ?? '.'}`);
  }
  return resolved;
}

export class EvidenceService {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly store: EvidenceStore,
    private readonly commands: CommandAdapter,
    private readonly clock: EvidenceClock = systemClock,
    private readonly journal?: EvidenceJournal,
    private readonly adapters: EvidenceAdapters = {},
  ) {}

  private redactionOptions(node: PlannedEvidenceNode, options: EvidenceRunOptions) {
    return {
      absolutePaths: [node.repositoryPath],
      ...(options.sensitiveValues ? { sensitiveValues: options.sensitiveValues } : {}),
      ...(options.redactionPatterns ? { patterns: options.redactionPatterns } : {}),
    };
  }

  private receipt(
    base: Omit<EvidenceReceiptFacts, 'compositionDigest'>,
    compositionDigest: string,
  ): EvidenceReceipt {
    return createEvidenceReceipt({ ...base, compositionDigest });
  }

  private async persist(receipt: EvidenceReceipt, options: EvidenceRunOptions): Promise<void> {
    if (options.nodeSnapshot) {
      const snapshot = options.nodeSnapshot;
      const outputManifest =
        snapshot.outputs.length && receipt.status === 'passed'
          ? await options.inputProofs!.captureOutputs(snapshot)
          : null;
      const proofArtifacts = [
        ...(options.derivedInputs ?? []).map((entry) => entry.manifest),
        ...(outputManifest ? [outputManifest] : []),
      ];
      const artifacts = [
        ...new Map(
          [...receipt.artifacts, ...proofArtifacts].map((entry) => [entry.sha256, entry]),
        ).values(),
      ];
      Object.assign(
        receipt,
        createEvidenceReceipt(
          {
            ...receipt,
            sourceFingerprint: snapshot.fingerprint,
            derivedInputs: options.derivedInputs ?? [],
            outputManifest,
            artifacts,
          },
          [
            ...snapshot.dependencies,
            ...(options.derivedInputs ?? []).map((input) => ({
              partition: 'implementation-content' as const,
              identity: input.contentDigest,
            })),
          ],
          [...(options.predecessorReceipts?.values() ?? [])].map((entry) => entry.receiptId),
        ),
      );
    }
    await this.store.saveReceipt(receipt);
    await this.journal?.recordCompletion(
      receipt.attemptId,
      receipt.nodeId,
      receipt.receiptId,
      receipt.completedAt,
    );
    await options.afterNodeCommitted?.(receipt);
  }

  private async command(
    node: Extract<PlannedEvidenceNode, { type: 'command' }>,
    attemptId: string,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<NodeExecution> {
    const startedAt = this.clock.now().toISOString();
    let reusable =
      node.cache && options.nodeSnapshot?.cacheable !== false
        ? options.reusableReceipts?.find((candidate) =>
            canReuseReceipt(candidate, {
              nodeId: node.id,
              inputFingerprint,
              now: startedAt,
              adapterKind: 'command',
              compositionDigest: options.compositionDigest,
            }),
          )
        : undefined;
    if (
      reusable &&
      options.nodeSnapshot &&
      options.inputProofs &&
      !(await options.inputProofs.outputsCurrent(options.nodeSnapshot, reusable))
    )
      reusable = undefined;
    await this.journal?.recordIntent(attemptId, node.id, startedAt);
    if (reusable) {
      const receipt = reuseReceipt({
        receipt: reusable,
        attemptId,
        startedAt,
        completedAt: this.clock.now().toISOString(),
      });
      await this.persist(receipt, options);
      return { receipt };
    }

    const result = await this.commands.run({
      executable: node.executable,
      args: node.args,
      cwd: resolveNodeCwd(node.repositoryPath, node.cwd),
      timeoutMs: node.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.maxOutputBytes ? { maxOutputBytes: options.maxOutputBytes } : {}),
    });
    const completedAt = this.clock.now().toISOString();
    const findings: EvidenceFinding[] = [];
    const redaction = this.redactionOptions(node, options);
    if (result.error) {
      findings.push({
        code: 'command-start-failed',
        severity: 'error',
        summary: redactEvidenceText(result.error, redaction).contents,
      });
    }
    if (result.timedOut) {
      findings.push({
        code: 'command-timeout',
        severity: 'error',
        summary: `Command exceeded ${node.timeoutMs} ms`,
      });
    }
    for (const stream of ['stdout', 'stderr'] as const) {
      if (result[`${stream}Truncated`]) {
        findings.push({
          code: 'command-output-truncated',
          severity: 'warning',
          summary: `${stream} exceeded the configured output limit after ${result[`${stream}Bytes`]} bytes`,
        });
      }
    }
    const tests =
      result.exitCode === 0 && node.zeroTests
        ? parseTestExecution(`${result.stdout}\n${result.stderr}`)
        : null;
    if (tests?.executed === 0 && node.zeroTests !== 'ignore') {
      findings.push({
        code: 'no-tests-detected',
        severity: node.zeroTests === 'blocking' ? 'error' : 'warning',
        summary: `${tests.framework} reported zero executed tests: ${tests.source}`,
      });
    }
    const artifacts: ArtifactRef[] = [];
    for (const stream of ['stdout', 'stderr'] as const) {
      if (result[stream].length === 0) continue;
      artifacts.push(
        await this.artifacts.put(redactEvidenceText(result[stream], redaction).contents, {
          artifactType: `command-${stream}`,
          mediaType: 'text/plain; charset=utf-8',
          redacted: true,
        }),
      );
    }
    const status =
      result.exitCode !== 0 || result.timedOut
        ? 'failed'
        : tests?.executed === 0 && node.zeroTests === 'blocking'
          ? 'incomplete'
          : 'passed';
    const receipt = this.receipt(
      {
        attemptId,
        nodeId: node.id,
        adapter: 'command/local',
        trust: 'verified',
        freshness: 'fresh',
        status,
        inputFingerprint,
        startedAt,
        completedAt,
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        ...(node.cache
          ? {
              validUntil: new Date(
                Date.parse(completedAt) + (node.cacheTtlMs ?? 60 * 60_000),
              ).toISOString(),
            }
          : {}),
        ...(result.pid !== undefined
          ? {
              process: {
                pid: result.pid,
                ...(result.processIdentity ? { identity: result.processIdentity } : {}),
              },
            }
          : {}),
        artifacts,
        findings,
      },
      options.compositionDigest,
    );
    await this.persist(receipt, options);
    return { receipt };
  }

  private async serviceArtifacts(
    node: PlannedEvidenceNode,
    observation: ServiceObservation,
    options: EvidenceRunOptions,
  ): Promise<ArtifactRef[]> {
    const artifacts: ArtifactRef[] = [];
    const redaction = this.redactionOptions(node, options);
    for (const stream of ['stdout', 'stderr'] as const) {
      if (observation.logs[stream].length === 0) continue;
      artifacts.push(
        await this.artifacts.put(redactEvidenceText(observation.logs[stream], redaction).contents, {
          artifactType: `service-${stream}`,
          mediaType: 'text/plain; charset=utf-8',
          redacted: true,
        }),
      );
    }
    artifacts.push(
      await this.artifacts.put(
        redactEvidenceText(JSON.stringify(observation.probes), redaction).contents,
        { artifactType: 'service-readiness-probes', mediaType: 'application/json', redacted: true },
      ),
    );
    return artifacts;
  }

  private async service(
    node: Extract<PlannedEvidenceNode, { type: 'service' }>,
    attemptId: string,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<NodeExecution> {
    const startedAt = this.clock.now().toISOString();
    await this.journal?.recordIntent(attemptId, node.id, startedAt);
    if (!this.adapters.services) {
      const receipt = this.receipt(
        {
          attemptId,
          nodeId: node.id,
          adapter: `service/${node.mode}`,
          trust: 'observed',
          freshness: 'fresh',
          status: 'incomplete',
          inputFingerprint,
          startedAt,
          completedAt: this.clock.now().toISOString(),
          artifacts: [],
          findings: [
            {
              code: 'service-adapter-unavailable',
              severity: 'error',
              summary: 'No service adapter is available for this Evidence run',
            },
          ],
        },
        options.compositionDigest,
      );
      await this.persist(receipt, options);
      return { receipt };
    }

    let session: ManagedServiceSession | undefined;
    let observation: ServiceObservation;
    try {
      if (node.mode === 'managed') {
        session = await this.adapters.services.startManaged({
          serviceId: node.id,
          executable: node.executable,
          args: node.args,
          cwd: resolveNodeCwd(node.repositoryPath, node.cwd),
          readiness: node.readiness,
          startupTimeoutMs: node.startupTimeoutMs,
          ...(node.probeIntervalMs ? { probeIntervalMs: node.probeIntervalMs } : {}),
          ...(options.maxOutputBytes ? { maxOutputBytes: options.maxOutputBytes } : {}),
          ...(node.resourceKeys ? { resourceKeys: node.resourceKeys } : {}),
        });
        observation = await session.waitUntilReady();
      } else {
        observation = await this.adapters.services.observeAttached({
          serviceId: node.id,
          readiness: node.readiness,
          startupTimeoutMs: node.startupTimeoutMs,
          ...(node.probeIntervalMs ? { probeIntervalMs: node.probeIntervalMs } : {}),
          ...(node.buildIdentity
            ? { buildIdentity: { ...node.buildIdentity, expected: inputFingerprint } }
            : {}),
        });
      }
    } catch (error) {
      await session?.stop();
      const receipt = this.receipt(
        {
          attemptId,
          nodeId: node.id,
          adapter: `service/${node.mode}`,
          trust: node.mode === 'managed' ? 'verified' : 'observed',
          freshness: 'fresh',
          status: 'incomplete',
          inputFingerprint,
          startedAt,
          completedAt: this.clock.now().toISOString(),
          artifacts: [],
          findings: [
            {
              code: 'service-start-failed',
              severity: 'error',
              summary: redactEvidenceText(
                error instanceof Error ? error.message : String(error),
                this.redactionOptions(node, options),
              ).contents,
            },
          ],
        },
        options.compositionDigest,
      );
      await this.persist(receipt, options);
      return { receipt };
    }

    const findings: EvidenceFinding[] = [];
    if (observation.status !== 'ready') {
      findings.push({
        code: observation.status === 'timed_out' ? 'service-readiness-timeout' : 'service-failed',
        severity: 'error',
        summary: `Service ${node.id} finished readiness as ${observation.status}`,
      });
    }
    if (observation.logs.stdoutTruncated || observation.logs.stderrTruncated) {
      findings.push({
        code: 'service-output-truncated',
        severity: 'warning',
        summary: `Service ${node.id} output exceeded the configured limit`,
      });
    }
    const receipt = this.receipt(
      {
        attemptId,
        nodeId: node.id,
        adapter: `service/${node.mode}`,
        trust: observation.trust,
        freshness: 'fresh',
        status: observation.status === 'ready' ? 'passed' : 'failed',
        inputFingerprint,
        startedAt,
        completedAt: this.clock.now().toISOString(),
        ...(observation.exitCode !== undefined ? { exitCode: observation.exitCode } : {}),
        ...(observation.process ? { process: observation.process } : {}),
        artifacts: await this.serviceArtifacts(node, observation, options),
        findings,
      },
      options.compositionDigest,
    );
    await this.persist(receipt, options);
    if (session && observation.status !== 'ready') await session.stop();
    return {
      receipt,
      ...(session && observation.status === 'ready' ? { managedSession: session } : {}),
    };
  }

  private async browser(
    node: Extract<PlannedEvidenceNode, { type: 'browser' }>,
    attemptId: string,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<NodeExecution> {
    const startedAt = this.clock.now().toISOString();
    await this.journal?.recordIntent(attemptId, node.id, startedAt);
    const result: BrowserJourneyResult = this.adapters.browser
      ? await this.adapters.browser.run(node.journey, node.source)
      : {
          journeyId: node.journey.journeyId,
          status: 'incomplete',
          trust: null,
          browser: null,
          actions: [],
          artifacts: [],
          console: [],
          pageErrors: [],
          failedRequests: [],
          findings: [
            {
              code: 'browser-adapter-unavailable',
              severity: 'error',
              summary: 'No browser adapter is available for this Evidence run',
            },
          ],
        };
    const receipt = this.receipt(
      {
        attemptId,
        nodeId: node.id,
        adapter: `browser/${node.source}`,
        trust: result.trust ?? 'observed',
        freshness: 'fresh',
        status: result.status,
        inputFingerprint,
        startedAt,
        completedAt: this.clock.now().toISOString(),
        artifacts: result.artifacts,
        findings: result.findings,
      },
      options.compositionDigest,
    );
    await this.persist(receipt, options);
    return { receipt };
  }

  private async visual(
    node: Extract<PlannedEvidenceNode, { type: 'visual' }>,
    plan: EvidenceExecutionPlan,
    receipts: ReadonlyMap<string, EvidenceReceipt>,
    attemptId: string,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<NodeExecution> {
    const startedAt = this.clock.now().toISOString();
    await this.journal?.recordIntent(attemptId, node.id, startedAt);
    const browserNode = plan.nodes.find(
      (candidate): candidate is Extract<PlannedEvidenceNode, { type: 'browser' }> =>
        candidate.id === node.browserNode && candidate.type === 'browser',
    );
    const screenshot = receipts
      .get(node.browserNode)
      ?.artifacts.find((artifact) => artifact.mediaType === 'image/png');
    const findings: EvidenceFinding[] = [];
    const artifacts: ArtifactRef[] = [];
    let status: 'passed' | 'incomplete' = 'incomplete';
    let decisions: RequirementsConflictDecisionRequest[] = [];
    if (!browserNode || !screenshot) {
      findings.push({
        code: 'visual-screenshot-unavailable',
        severity: 'error',
        summary: `Visual node ${node.id} cannot find a screenshot from ${node.browserNode}`,
      });
    } else {
      const request = createVisualInspectionRequest({
        screenshot,
        viewport: {
          width: browserNode.journey.viewport.width,
          height: browserNode.journey.viewport.height,
          deviceScaleFactor: browserNode.journey.viewport.deviceScaleFactor ?? 1,
        },
        page: { url: node.pageUrl },
        criteria: node.criteria,
        designReferences: [],
      });
      artifacts.push(
        await this.artifacts.put(JSON.stringify(request), {
          artifactType: 'visual-inspection-request',
          mediaType: 'application/json',
          redacted: true,
        }),
      );
      const inspection = await collectVisualInspection(request, this.adapters.visual);
      if (inspection.status === 'incomplete') {
        findings.push({
          code: 'visual-adapter-unavailable',
          severity: 'error',
          summary: 'No visual inspection adapter accepted the current request',
        });
      } else {
        artifacts.push(
          await this.artifacts.put(JSON.stringify(inspection.response), {
            artifactType: 'visual-inspection-response',
            mediaType: 'application/json',
            redacted: true,
          }),
        );
        decisions = conflictDecisionsFromVisualResponse({
          changeId: node.changeId,
          nodeId: node.id,
          response: inspection.response,
        });
        for (const finding of inspection.response.findings) {
          findings.push({
            code: finding.conflict ? 'requirements-conflict' : 'visual-finding',
            severity: finding.conflict ? 'error' : 'warning',
            summary: finding.summary,
            artifactRefs: finding.evidenceRefs,
          });
        }
        status = decisions.length > 0 ? 'incomplete' : 'passed';
      }
    }
    const receipt = this.receipt(
      {
        attemptId,
        nodeId: node.id,
        adapter: 'visual/structured',
        trust: 'verified',
        freshness: 'fresh',
        status,
        inputFingerprint,
        startedAt,
        completedAt: this.clock.now().toISOString(),
        artifacts,
        findings,
      },
      options.compositionDigest,
    );
    await this.persist(receipt, options);
    return { receipt, decisionRequests: decisions };
  }

  private async specification(
    node: Extract<PlannedEvidenceNode, { type: 'specification' }>,
    attemptId: string,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<NodeExecution> {
    const startedAt = this.clock.now().toISOString();
    await this.journal?.recordIntent(attemptId, node.id, startedAt);
    if (!this.adapters.specification) {
      const receipt = this.receipt(
        {
          attemptId,
          nodeId: node.id,
          adapter: 'specification',
          trust: 'verified',
          freshness: 'fresh',
          status: 'incomplete',
          inputFingerprint,
          startedAt,
          completedAt: this.clock.now().toISOString(),
          artifacts: [],
          findings: [
            {
              code: 'specification-provider-missing',
              severity: 'error',
              summary: 'Specification Provider is not active',
            },
          ],
        },
        options.compositionDigest,
      );
      await this.persist(receipt, options);
      return { receipt };
    }
    const validation = await this.adapters.specification.validate(node.changeId, {
      strict: node.strict,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const receipt = this.receipt(
      {
        attemptId,
        nodeId: node.id,
        adapter: `specification:${validation.provider.id}@${validation.provider.version}`,
        trust: 'verified',
        freshness: 'fresh',
        status: validation.valid ? 'passed' : 'failed',
        inputFingerprint,
        startedAt,
        completedAt: this.clock.now().toISOString(),
        artifacts: [],
        findings: validation.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
          summary: diagnostic.message,
        })),
      },
      options.compositionDigest,
    );
    await this.persist(receipt, options);
    return { receipt };
  }

  private execute(
    node: PlannedEvidenceNode,
    plan: EvidenceExecutionPlan,
    receipts: ReadonlyMap<string, EvidenceReceipt>,
    attemptId: string,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<NodeExecution> {
    if (node.type === 'command') return this.command(node, attemptId, inputFingerprint, options);
    if (node.type === 'service') return this.service(node, attemptId, inputFingerprint, options);
    if (node.type === 'browser') return this.browser(node, attemptId, inputFingerprint, options);
    if (node.type === 'visual') {
      return this.visual(node, plan, receipts, attemptId, inputFingerprint, options);
    }
    return this.specification(node, attemptId, inputFingerprint, options);
  }

  async run(
    plan: EvidenceExecutionPlan,
    inputFingerprint: string,
    options: EvidenceRunOptions,
  ): Promise<EvidenceRunResult> {
    if (options.signal?.aborted) throw options.signal.reason;
    const attemptId = options.attemptId ?? randomUUID();
    const startedAt = this.clock.now().toISOString();
    const attempt: EvidenceAttempt = {
      schemaVersion: 1,
      apiVersion: EVIDENCE_API_VERSION,
      kind: 'EvidenceAttempt',
      attemptId,
      compositionDigest: options.compositionDigest,
      profileId: plan.profileId,
      inputFingerprint,
      startedAt,
      receiptIds: [],
      status: 'running',
      dependencies: createEvidenceDependencyRecord({
        subjectKind: 'attempt',
        subjectId: attemptId,
        dependencies: [
          { partition: 'implementation-content', identity: evidenceInputDigest(inputFingerprint) },
        ],
      }),
    };
    await this.store.saveAttempt(attempt);

    const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
    const checks = new Map<string, EvidenceCheck>();
    const byNode = new Map<string, EvidenceReceipt>();
    const sessions = new Map<string, ManagedServiceSession>();
    const findings: EvidenceFinding[] = [];
    const decisionRequests: RequirementsConflictDecisionRequest[] = [];
    const pending = new Set(plan.order);
    try {
      while (pending.size > 0) {
        if (options.signal?.aborted) throw options.signal.reason;
        for (const nodeId of [...pending]) {
          const node = nodes.get(nodeId)!;
          if (!node.dependsOn.every((dependency) => checks.has(dependency))) continue;
          const blockedBy = node.dependsOn.filter(
            (dependency) => checks.get(dependency)?.status !== 'passed',
          );
          if (blockedBy.length === 0) continue;
          checks.set(nodeId, { nodeId, required: node.required, status: 'blocked', blockedBy });
          pending.delete(nodeId);
        }
        const readyCandidates = plan.order.filter(
          (nodeId) =>
            pending.has(nodeId) &&
            nodes
              .get(nodeId)!
              .dependsOn.every((dependency) => checks.get(dependency)?.status === 'passed'),
        );
        const ready = readyCandidates.slice(0, options.maxParallel ?? readyCandidates.length);
        if (ready.length === 0) {
          if (pending.size === 0) break;
          throw new Error(`Evidence graph stalled: ${[...pending].join(', ')}`);
        }
        for (const nodeId of ready) pending.delete(nodeId);
        const layer = await Promise.all(
          ready.map(async (nodeId) => {
            const snapshot = options.nodeInputs?.find((entry) => entry.nodeId === nodeId);
            const derivedInputs = snapshot?.derivedFrom.length
              ? await options.inputProofs!.captureDerived(snapshot, byNode)
              : [];
            const fingerprint = snapshot
              ? derivedInputs.length
                ? evidenceInputDigest({
                    source: snapshot.fingerprint,
                    derived: derivedInputs.map(({ producerId, contentDigest }) => ({
                      producerId,
                      contentDigest,
                    })),
                  }).slice(7)
                : snapshot.fingerprint
              : inputFingerprint;
            return this.execute(nodes.get(nodeId)!, plan, byNode, attemptId, fingerprint, {
              ...options,
              ...(snapshot
                ? {
                    nodeSnapshot: snapshot,
                    derivedInputs,
                    predecessorReceipts: new Map(
                      [...byNode].filter(
                        ([id]) =>
                          nodes.get(nodeId)!.dependsOn.includes(id) ||
                          snapshot.derivedFrom.some((claim) => claim.producerId === id),
                      ),
                    ),
                  }
                : {}),
            });
          }),
        );
        for (const [index, execution] of layer.entries()) {
          const nodeId = ready[index]!;
          const node = nodes.get(nodeId)!;
          const receipt = execution.receipt;
          byNode.set(nodeId, receipt);
          if (execution.managedSession) sessions.set(nodeId, execution.managedSession);
          findings.push(...receipt.findings);
          decisionRequests.push(...(execution.decisionRequests ?? []));
          checks.set(nodeId, {
            nodeId,
            required: node.required,
            status: receipt.status,
            trust: receipt.trust,
            freshness: receipt.freshness,
            receiptId: receipt.receiptId,
          });
        }
      }
    } finally {
      for (const nodeId of [...plan.order].reverse()) await sessions.get(nodeId)?.stop();
    }

    const receipts = plan.order
      .map((nodeId) => byNode.get(nodeId))
      .filter((value): value is EvidenceReceipt => value !== undefined);
    attempt.receiptIds = receipts.map((receipt) => receipt.receiptId);
    attempt.dependencies = createEvidenceDependencyRecord({
      ...attempt.dependencies,
      dependsOnEvidenceIds: attempt.receiptIds,
    });
    const completedAt = this.clock.now().toISOString();
    const endingFingerprint = options.captureEndingFingerprint
      ? await options.captureEndingFingerprint()
      : inputFingerprint;
    const superseded = endingFingerprint !== inputFingerprint;
    const invalidated = new Set<string>();
    if (options.nodeInputs && options.captureEndingNodeInputs) {
      const endingNodes = await options.captureEndingNodeInputs();
      const changedDependencies = options.nodeInputs.flatMap((source) =>
        source.dependencies.filter(
          (dependency) =>
            !endingNodes
              .find((node) => node.nodeId === source.nodeId)
              ?.dependencies.some(
                (entry) =>
                  entry.partition === dependency.partition &&
                  entry.identity === dependency.identity,
              ),
        ),
      );
      const invalidation = invalidateEvidenceDependencies({
        records: receipts.map((receipt) => receipt.dependencies),
        changedDependencies,
        providerAvailable: true,
      });
      for (const receipt of receipts)
        if (invalidation.invalidatedEvidenceIds.includes(receipt.receiptId))
          invalidated.add(receipt.nodeId);
      for (const source of options.nodeInputs) {
        if (
          endingNodes.find((node) => node.nodeId === source.nodeId)?.fingerprint !==
          source.fingerprint
        )
          invalidated.add(source.nodeId);
      }
    } else if (superseded) plan.nodes.forEach((node) => invalidated.add(node.id));
    if (options.inputProofs && options.nodeInputs)
      for (const receipt of receipts.filter((entry) => entry.status === 'passed')) {
        const snapshot = options.nodeInputs.find((entry) => entry.nodeId === receipt.nodeId)!;
        if (!(await options.inputProofs.outputsCurrent(snapshot, receipt)))
          invalidated.add(receipt.nodeId);
        if (snapshot.derivedFrom.length) {
          try {
            if (
              canonicalJson(await options.inputProofs.captureDerived(snapshot, byNode)) !==
              canonicalJson(receipt.derivedInputs)
            )
              invalidated.add(receipt.nodeId);
          } catch {
            invalidated.add(receipt.nodeId);
          }
        }
      }
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of plan.nodes)
        if (!invalidated.has(node.id) && node.dependsOn.some((id) => invalidated.has(id))) {
          invalidated.add(node.id);
          grew = true;
        }
    }
    const orderedChecks = plan.order.map((nodeId) => {
      const check = checks.get(nodeId)!;
      return (invalidated.has(nodeId) || (superseded && !invalidated.size)) &&
        check.status === 'passed'
        ? { ...check, freshness: 'superseded' as const }
        : check;
    });
    const evidenceArtifactDigests = [
      ...new Set(
        receipts.flatMap((receipt) => receipt.artifacts.map((artifact) => artifact.sha256)),
      ),
    ].sort();
    const bundleBase = {
      attemptId,
      compositionDigest: options.compositionDigest,
      profileId: plan.profileId,
      inputFingerprint,
      createdAt: completedAt,
      checks: orderedChecks,
      receiptIds: receipts.map((receipt) => receipt.receiptId),
      artifactDigests: evidenceArtifactDigests,
      findings,
      acceptanceTrace: options.acceptanceContext
        ? createAcceptanceTrace({
            context: options.acceptanceContext,
            checks: orderedChecks,
            receipts,
            inputFingerprint,
            ...(options.nodeInputs ? { nodeInputs: options.nodeInputs } : {}),
          })
        : null,
    };
    const preliminary = createEvidenceBundle(bundleBase);
    const verificationReport = createVerificationReport({
      plan,
      receipts,
      bundle: preliminary,
      redaction: {
        ...(options.sensitiveValues ? { sensitiveValues: options.sensitiveValues } : {}),
        ...(options.redactionPatterns ? { patterns: options.redactionPatterns } : {}),
      },
    });
    const reportArtifact = await this.artifacts.put(verificationReport.contents, {
      artifactType: 'verification-report',
      mediaType: 'application/json; charset=utf-8',
      redacted: true,
    });
    const finalBase = {
      ...bundleBase,
      artifactDigests: [...evidenceArtifactDigests, reportArtifact.sha256].sort(),
      verificationReport: reportArtifact,
    };
    const bundle = createEvidenceBundle(finalBase);
    attempt.completedAt = completedAt;
    attempt.status = superseded || invalidated.size ? 'superseded' : 'completed';
    await this.store.saveAttempt(attempt);
    await this.store.saveBundle(bundle);
    return { attempt, receipts, bundle, decisionRequests };
  }
}
