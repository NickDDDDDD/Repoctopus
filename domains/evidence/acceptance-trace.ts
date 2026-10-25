import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  AcceptanceTrace,
  AcceptanceTraceEntry,
  EvidenceAcceptanceContext,
  EvidenceCheck,
  EvidenceReceipt,
} from './types.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createAcceptanceTrace(input: {
  context: EvidenceAcceptanceContext;
  checks: readonly EvidenceCheck[];
  receipts: readonly EvidenceReceipt[];
  inputFingerprint: string;
}): AcceptanceTrace {
  const acceptanceIds = [...input.context.acceptanceIds].sort();
  if (acceptanceIds.length === 0 || new Set(acceptanceIds).size !== acceptanceIds.length) {
    throw new Error('Acceptance context requires unique Acceptance identities');
  }
  const coverageByAcceptance = new Map(
    input.context.acceptanceCoverage.map((coverage) => [coverage.acceptanceId, coverage]),
  );
  if (coverageByAcceptance.size !== input.context.acceptanceCoverage.length) {
    throw new Error('Acceptance context contains duplicate coverage entries');
  }
  if (
    input.context.acceptanceCoverage.some(
      (coverage) => !acceptanceIds.includes(coverage.acceptanceId) || coverage.nodeIds.length === 0,
    ) ||
    acceptanceIds.some((acceptanceId) => !coverageByAcceptance.has(acceptanceId))
  ) {
    throw new Error('Acceptance coverage must exactly cover the Acceptance set');
  }
  const checks = new Map(input.checks.map((check) => [check.nodeId, check]));
  if (checks.size !== input.checks.length)
    throw new Error('Evidence checks contain duplicate nodes');
  const receipts = new Map(input.receipts.map((receipt) => [receipt.receiptId, receipt]));
  if (receipts.size !== input.receipts.length) {
    throw new Error('Evidence receipts contain duplicate identities');
  }

  const entries = acceptanceIds.map((acceptanceId): AcceptanceTraceEntry => {
    const nodeIds = [...coverageByAcceptance.get(acceptanceId)!.nodeIds].sort();
    if (new Set(nodeIds).size !== nodeIds.length) {
      throw new Error(`Acceptance ${acceptanceId} contains duplicate coverage nodes`);
    }
    const receiptIds: string[] = [];
    let failed = false;
    let missing = false;
    for (const nodeId of nodeIds) {
      const check = checks.get(nodeId);
      if (!check || !check.required || !check.receiptId) {
        missing = true;
        continue;
      }
      const receipt = receipts.get(check.receiptId);
      if (
        !receipt ||
        receipt.nodeId !== nodeId ||
        receipt.inputFingerprint !== input.inputFingerprint
      ) {
        missing = true;
        continue;
      }
      receiptIds.push(receipt.receiptId);
      if (
        check.status !== 'passed' ||
        check.trust !== 'verified' ||
        !['fresh', 'reused'].includes(check.freshness ?? '') ||
        receipt.status !== 'passed' ||
        receipt.trust !== 'verified' ||
        !['fresh', 'reused'].includes(receipt.freshness)
      ) {
        failed = true;
      }
    }
    return {
      acceptanceId,
      status: missing ? 'missing' : failed ? 'failed' : 'passed',
      nodeIds,
      receiptIds: [...new Set(receiptIds)].sort(),
    };
  });
  const base = {
    schemaVersion: 1 as const,
    verificationInputDigest: input.context.verificationInputDigest,
    acceptanceSetHash: input.context.acceptanceSetHash,
    total: entries.length,
    passed: entries.filter((entry) => entry.status === 'passed').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    missing: entries.filter((entry) => entry.status === 'missing').length,
    entries,
  };
  return { ...base, digest: sha256(base) };
}
