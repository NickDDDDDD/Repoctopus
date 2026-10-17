import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ArtifactStore, EvidenceJournal, EvidenceStore } from './ports.js';
import type { CommandAdapter } from '../feedback/ports.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import { redactEvidenceText } from './redaction.js';
import { createEvidenceBundle } from './gate.js';
import { canReuseReceipt, reuseReceipt } from './lifecycle.js';
import { parseTestExecution } from './test-output.js';
import {
  EVIDENCE_API_VERSION,
  type ArtifactRef,
  type EvidenceAttempt,
  type EvidenceBundle,
  type EvidenceCheck,
  type EvidenceFinding,
  type EvidenceReceipt,
} from './types.js';

export interface EvidenceRunResult {
  attempt: EvidenceAttempt;
  receipts: EvidenceReceipt[];
  bundle: EvidenceBundle;
}

export interface EvidenceRunOptions {
  attemptId?: string;
  reusableReceipts?: readonly EvidenceReceipt[];
  captureEndingFingerprint?: () => Promise<string>;
  maxOutputBytes?: number;
  sensitiveValues?: readonly string[];
  redactionPatterns?: readonly RegExp[];
  afterNodeCommitted?: (receipt: EvidenceReceipt) => void | Promise<void>;
}

export interface EvidenceClock {
  now(): Date;
}

const systemClock: EvidenceClock = { now: () => new Date() };

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function resolveCommandCwd(repositoryPath: string, configuredCwd?: string): string {
  const resolved = path.resolve(repositoryPath, configuredCwd ?? '.');
  const relative = path.relative(repositoryPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Command cwd escapes repository: ${configuredCwd ?? '.'}`);
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
  ) {}

  async run(
    plan: EvidenceExecutionPlan,
    inputFingerprint: string,
    options: EvidenceRunOptions = {},
  ): Promise<EvidenceRunResult> {
    const attemptId = options.attemptId ?? randomUUID();
    const startedAt = this.clock.now().toISOString();
    const attempt: EvidenceAttempt = {
      apiVersion: EVIDENCE_API_VERSION,
      kind: 'EvidenceAttempt',
      attemptId,
      profileId: plan.profileId,
      inputFingerprint,
      startedAt,
      receiptIds: [],
      status: 'running',
    };
    await this.store.saveAttempt(attempt);

    const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
    const checks = new Map<string, EvidenceCheck>();
    const receipts: EvidenceReceipt[] = [];
    const findings: EvidenceFinding[] = [];

    for (const nodeId of plan.order) {
      const node = nodes.get(nodeId)!;
      const blockedBy = node.dependsOn.filter(
        (dependency) => checks.get(dependency)?.status !== 'passed',
      );
      if (blockedBy.length > 0) {
        checks.set(nodeId, {
          nodeId,
          required: node.required,
          status: 'blocked',
          blockedBy,
        });
        continue;
      }

      const reuseStartedAt = this.clock.now().toISOString();
      const reusable = node.cache
        ? options.reusableReceipts?.find((receipt) =>
            canReuseReceipt(receipt, {
              nodeId,
              inputFingerprint,
              now: reuseStartedAt,
              adapterKind: 'command',
            }),
          )
        : undefined;
      if (reusable) {
        await this.journal?.recordIntent(attemptId, nodeId, reuseStartedAt);
        const receipt = reuseReceipt({
          receipt: reusable,
          attemptId,
          startedAt: reuseStartedAt,
          completedAt: this.clock.now().toISOString(),
        });
        await this.store.saveReceipt(receipt);
        await this.journal?.recordCompletion(
          attemptId,
          nodeId,
          receipt.receiptId,
          receipt.completedAt,
        );
        await options.afterNodeCommitted?.(receipt);
        receipts.push(receipt);
        attempt.receiptIds.push(receipt.receiptId);
        findings.push(...receipt.findings);
        checks.set(nodeId, {
          nodeId,
          required: node.required,
          status: receipt.status,
          trust: receipt.trust,
          freshness: receipt.freshness,
          receiptId: receipt.receiptId,
        });
        continue;
      }

      const commandStartedAt = this.clock.now().toISOString();
      await this.journal?.recordIntent(attemptId, nodeId, commandStartedAt);
      const result = await this.commands.run({
        executable: node.executable,
        args: node.args,
        cwd: resolveCommandCwd(node.repositoryPath, node.cwd),
        timeoutMs: node.timeoutMs,
        ...(options.maxOutputBytes ? { maxOutputBytes: options.maxOutputBytes } : {}),
      });
      const commandCompletedAt = this.clock.now().toISOString();
      const receiptFindings: EvidenceFinding[] = [];
      const redactionOptions = {
        absolutePaths: [node.repositoryPath],
        ...(options.sensitiveValues ? { sensitiveValues: options.sensitiveValues } : {}),
        ...(options.redactionPatterns ? { patterns: options.redactionPatterns } : {}),
      };
      if (result.error) {
        receiptFindings.push({
          code: 'command-start-failed',
          severity: 'error',
          summary: redactEvidenceText(result.error, redactionOptions).contents,
        });
      }
      if (result.timedOut) {
        receiptFindings.push({
          code: 'command-timeout',
          severity: 'error',
          summary: `Command exceeded ${node.timeoutMs} ms`,
        });
      }
      for (const stream of ['stdout', 'stderr'] as const) {
        if (result[`${stream}Truncated`]) {
          receiptFindings.push({
            code: 'command-output-truncated',
            severity: 'warning',
            summary: `${stream} exceeded the configured output limit after ${result[`${stream}Bytes`]} bytes`,
          });
        }
      }
      const testExecution =
        result.exitCode === 0 && node.zeroTests
          ? parseTestExecution(`${result.stdout}\n${result.stderr}`)
          : null;
      if (testExecution?.executed === 0 && node.zeroTests !== 'ignore') {
        receiptFindings.push({
          code: 'no-tests-detected',
          severity: node.zeroTests === 'blocking' ? 'error' : 'warning',
          summary: `${testExecution.framework} reported zero executed tests: ${testExecution.source}`,
        });
      }
      const artifactRefs: ArtifactRef[] = [];
      if (result.stdout.length > 0) {
        const redacted = redactEvidenceText(result.stdout, redactionOptions);
        artifactRefs.push(
          await this.artifacts.put(redacted.contents, {
            artifactType: 'command-stdout',
            mediaType: 'text/plain; charset=utf-8',
            redacted: true,
          }),
        );
      }
      if (result.stderr.length > 0) {
        const redacted = redactEvidenceText(result.stderr, redactionOptions);
        artifactRefs.push(
          await this.artifacts.put(redacted.contents, {
            artifactType: 'command-stderr',
            mediaType: 'text/plain; charset=utf-8',
            redacted: true,
          }),
        );
      }
      const status: 'passed' | 'failed' | 'incomplete' =
        result.exitCode !== 0 || result.timedOut
          ? 'failed'
          : testExecution?.executed === 0 && node.zeroTests === 'blocking'
            ? 'incomplete'
            : 'passed';
      const receiptBase = {
        attemptId,
        nodeId,
        adapter: 'command/local',
        trust: 'verified' as const,
        freshness: 'fresh' as const,
        status,
        inputFingerprint,
        startedAt: commandStartedAt,
        completedAt: commandCompletedAt,
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        ...(node.cache
          ? {
              validUntil: new Date(
                Date.parse(commandCompletedAt) + (node.cacheTtlMs ?? 60 * 60_000),
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
        artifacts: artifactRefs,
        findings: receiptFindings,
      };
      const receipt: EvidenceReceipt = {
        apiVersion: EVIDENCE_API_VERSION,
        kind: 'EvidenceReceipt',
        receiptId: digest(receiptBase),
        ...receiptBase,
      };
      await this.store.saveReceipt(receipt);
      await this.journal?.recordCompletion(
        attemptId,
        nodeId,
        receipt.receiptId,
        receipt.completedAt,
      );
      await options.afterNodeCommitted?.(receipt);
      receipts.push(receipt);
      attempt.receiptIds.push(receipt.receiptId);
      findings.push(...receiptFindings);
      checks.set(nodeId, {
        nodeId,
        required: node.required,
        status,
        trust: receipt.trust,
        freshness: receipt.freshness,
        receiptId: receipt.receiptId,
      });
    }

    const completedAt = this.clock.now().toISOString();
    const endingFingerprint = options.captureEndingFingerprint
      ? await options.captureEndingFingerprint()
      : inputFingerprint;
    const superseded = endingFingerprint !== inputFingerprint;
    const orderedChecks = plan.order.map((nodeId) => {
      const check = checks.get(nodeId)!;
      return superseded && check.status === 'passed'
        ? { ...check, freshness: 'superseded' as const }
        : check;
    });
    const bundleBase = {
      attemptId,
      profileId: plan.profileId,
      inputFingerprint,
      createdAt: completedAt,
      checks: orderedChecks,
      receiptIds: receipts.map((receipt) => receipt.receiptId),
      artifactDigests: [
        ...new Set(
          receipts.flatMap((receipt) => receipt.artifacts.map((artifact) => artifact.sha256)),
        ),
      ].sort(),
      findings,
    };
    const bundle = createEvidenceBundle({
      bundleId: digest(bundleBase),
      ...bundleBase,
    });
    attempt.completedAt = completedAt;
    attempt.status = superseded ? 'superseded' : 'completed';
    await this.store.saveAttempt(attempt);
    await this.store.saveBundle(bundle);
    return { attempt, receipts, bundle };
  }
}
