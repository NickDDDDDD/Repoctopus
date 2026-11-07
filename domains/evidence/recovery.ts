import { createHash } from 'node:crypto';

import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { createEvidenceBundle } from './gate.js';
import type {
  ArtifactStore,
  EvidenceJournal,
  EvidenceStore,
  EvidenceInputProofPort,
} from './ports.js';
import { EvidenceInputDriftError, type EvidenceNodeInputSnapshot } from './input-snapshot.js';
import { evidenceReceiptInputCurrent } from './receipt.js';
import { createEvidenceDependencyRecord } from './dependencies.js';
import type { EvidenceBundle, EvidenceCheck, EvidenceFinding, EvidenceReceipt } from './types.js';
import type { EvidenceAcceptanceContext } from './types.js';
import { createAcceptanceTrace } from './acceptance-trace.js';
import { createVerificationReport } from './verification-report.js';

export async function recoverEvidenceAttempt(input: {
  attemptId: string;
  plan: EvidenceExecutionPlan;
  store: EvidenceStore;
  journal: EvidenceJournal;
  timestamp: string;
  endingFingerprint?: string;
  artifacts?: ArtifactStore;
  acceptanceContext?: EvidenceAcceptanceContext;
  allowTerminalAttempt?: boolean;
  nodeInputs?: readonly EvidenceNodeInputSnapshot[];
  endingNodeInputs?: readonly EvidenceNodeInputSnapshot[];
  inputProofs?: EvidenceInputProofPort;
}): Promise<{ receipts: EvidenceReceipt[]; bundle: EvidenceBundle }> {
  const attempt = await input.store.loadAttempt(input.attemptId);
  if (attempt.status !== 'running' && !input.allowTerminalAttempt)
    throw new Error(`Evidence attempt is not running: ${attempt.attemptId}`);
  const entries = await input.journal.load(input.attemptId);
  const intents = new Set(
    entries.filter((entry) => entry.type === 'node.intent').map((entry) => entry.nodeId),
  );
  const completed = new Map(
    entries
      .filter((entry) => entry.type === 'node.completed' && entry.receiptId)
      .map((entry) => [entry.nodeId, entry.receiptId!]),
  );
  const receipts: EvidenceReceipt[] = [];
  const checks = new Map<string, EvidenceCheck>();
  const findings: EvidenceFinding[] = [];
  const superseded =
    attempt.status === 'superseded' ||
    (input.endingFingerprint !== undefined && input.endingFingerprint !== attempt.inputFingerprint);
  const changedSources = new Set(
    input.nodeInputs
      ?.filter(
        (node) =>
          input.endingNodeInputs?.find((entry) => entry.nodeId === node.nodeId)?.fingerprint !==
          node.fingerprint,
      )
      .map((node) => node.nodeId) ?? [],
  );
  const forceSuperseded =
    superseded &&
    (attempt.status === 'superseded' || !input.endingNodeInputs || changedSources.size === 0);
  if (superseded) {
    findings.push({
      code: 'input-drift',
      severity: 'error',
      summary: 'Evidence inputs changed while the interrupted attempt was being recovered',
    });
  }
  const nodes = new Map(input.plan.nodes.map((node) => [node.id, node]));
  for (const nodeId of input.plan.order) {
    const node = nodes.get(nodeId)!;
    const blockedBy = node.dependsOn.filter(
      (dependency) =>
        checks.get(dependency)?.status !== 'passed' ||
        checks.get(dependency)?.freshness === 'superseded',
    );
    if (blockedBy.length > 0) {
      checks.set(nodeId, { nodeId, required: node.required, status: 'blocked', blockedBy });
      continue;
    }
    const receiptId = completed.get(nodeId);
    if (receiptId) {
      const receipt = await input.store.loadReceipt(receiptId);
      if (
        receipt.attemptId !== attempt.attemptId ||
        receipt.nodeId !== nodeId ||
        receipt.compositionDigest !== attempt.compositionDigest
      )
        throw new Error('Recovery Receipt does not match its committed node');
      receipts.push(receipt);
      const snapshot = input.nodeInputs?.find((entry) => entry.nodeId === nodeId);
      let nodeDrift = false;
      if (input.nodeInputs) {
        if (!snapshot || !evidenceReceiptInputCurrent(receipt, snapshot, receipts))
          throw new Error('Recovery Receipt dependency proof is invalid');
        nodeDrift =
          !!input.endingNodeInputs &&
          input.endingNodeInputs.find((entry) => entry.nodeId === nodeId)?.fingerprint !==
            snapshot.fingerprint;
        if (receipt.status === 'passed' && input.inputProofs) {
          nodeDrift ||= !(await input.inputProofs.outputsCurrent(snapshot, receipt));
          if (snapshot.derivedFrom.length) {
            try {
              nodeDrift ||=
                canonicalJson(
                  await input.inputProofs.captureDerived(
                    snapshot,
                    new Map(receipts.map((entry) => [entry.nodeId, entry])),
                  ),
                ) !== canonicalJson(receipt.derivedInputs);
            } catch (error) {
              if (error instanceof EvidenceInputDriftError) nodeDrift = true;
              else throw error;
            }
          }
        }
      }
      findings.push(...receipt.findings);
      checks.set(nodeId, {
        nodeId,
        required: node.required,
        status: receipt.status,
        trust: receipt.trust,
        freshness: nodeDrift || forceSuperseded ? 'superseded' : receipt.freshness,
        receiptId,
      });
      continue;
    }
    const code = intents.has(nodeId) ? 'recovery-uncertain-side-effect' : 'evidence-not-collected';
    const finding: EvidenceFinding = {
      code,
      severity: 'error',
      summary: intents.has(nodeId)
        ? 'The node started without a committed receipt and was not executed again'
        : 'The node had not started before recovery',
    };
    findings.push(finding);
    checks.set(nodeId, { nodeId, required: node.required, status: 'incomplete' });
  }
  const bundleBase = {
    attemptId: attempt.attemptId,
    compositionDigest: attempt.compositionDigest,
    profileId: attempt.profileId,
    inputFingerprint: attempt.inputFingerprint,
    createdAt: input.timestamp,
    checks: input.plan.order.map((nodeId) => checks.get(nodeId)!),
    receiptIds: receipts.map((receipt) => receipt.receiptId),
    artifactDigests: [
      ...new Set(
        receipts.flatMap((receipt) => receipt.artifacts.map((artifact) => artifact.sha256)),
      ),
    ].sort(),
    findings,
    acceptanceTrace: input.acceptanceContext
      ? createAcceptanceTrace({
          context: input.acceptanceContext,
          checks: input.plan.order.map((nodeId) => checks.get(nodeId)!),
          receipts,
          inputFingerprint: attempt.inputFingerprint,
          ...(input.nodeInputs ? { nodeInputs: input.nodeInputs } : {}),
        })
      : null,
  };
  let bundle = createEvidenceBundle({
    bundleId: createHash('sha256').update(canonicalJson(bundleBase)).digest('hex'),
    ...bundleBase,
  });
  if (input.artifacts) {
    const report = createVerificationReport({ plan: input.plan, receipts, bundle });
    const reportArtifact = await input.artifacts.put(report.contents, {
      artifactType: 'verification-report',
      mediaType: 'application/json; charset=utf-8',
      redacted: true,
    });
    const finalBase = {
      ...bundleBase,
      artifactDigests: [...bundleBase.artifactDigests, reportArtifact.sha256].sort(),
      verificationReport: reportArtifact,
    };
    bundle = createEvidenceBundle({
      bundleId: createHash('sha256').update(canonicalJson(finalBase)).digest('hex'),
      ...finalBase,
    });
  }
  attempt.receiptIds = bundle.receiptIds;
  attempt.dependencies = createEvidenceDependencyRecord({
    ...attempt.dependencies,
    dependsOnEvidenceIds: attempt.receiptIds,
  });
  attempt.completedAt = input.timestamp;
  attempt.status =
    superseded || [...checks.values()].some((check) => check.freshness === 'superseded')
      ? 'superseded'
      : 'completed';
  await input.store.saveAttempt(attempt);
  await input.store.saveBundle(bundle);
  return { receipts, bundle };
}
