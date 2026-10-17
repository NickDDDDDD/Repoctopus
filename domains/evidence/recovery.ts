import { createHash } from 'node:crypto';

import type { EvidenceExecutionPlan } from '../feedback/profile.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { createEvidenceBundle } from './gate.js';
import type { EvidenceJournal, EvidenceStore } from './ports.js';
import type { EvidenceBundle, EvidenceCheck, EvidenceFinding, EvidenceReceipt } from './types.js';

export async function recoverEvidenceAttempt(input: {
  attemptId: string;
  plan: EvidenceExecutionPlan;
  store: EvidenceStore;
  journal: EvidenceJournal;
  timestamp: string;
}): Promise<{ receipts: EvidenceReceipt[]; bundle: EvidenceBundle }> {
  const attempt = await input.store.loadAttempt(input.attemptId);
  if (attempt.status !== 'running')
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
  const nodes = new Map(input.plan.nodes.map((node) => [node.id, node]));
  for (const nodeId of input.plan.order) {
    const node = nodes.get(nodeId)!;
    const blockedBy = node.dependsOn.filter(
      (dependency) => checks.get(dependency)?.status !== 'passed',
    );
    if (blockedBy.length > 0) {
      checks.set(nodeId, { nodeId, required: node.required, status: 'blocked', blockedBy });
      continue;
    }
    const receiptId = completed.get(nodeId);
    if (receiptId) {
      const receipt = await input.store.loadReceipt(receiptId);
      receipts.push(receipt);
      findings.push(...receipt.findings);
      checks.set(nodeId, {
        nodeId,
        required: node.required,
        status: receipt.status,
        trust: receipt.trust,
        freshness: receipt.freshness,
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
  };
  const bundle = createEvidenceBundle({
    bundleId: createHash('sha256').update(canonicalJson(bundleBase)).digest('hex'),
    ...bundleBase,
  });
  attempt.receiptIds = bundle.receiptIds;
  attempt.completedAt = input.timestamp;
  attempt.status = 'completed';
  await input.store.saveAttempt(attempt);
  await input.store.saveBundle(bundle);
  return { receipts, bundle };
}
