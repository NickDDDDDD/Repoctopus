import type { EvidenceReceipt } from './types.js';
import { createEvidenceReceipt } from './receipt.js';

export interface ReceiptReuseRequest {
  nodeId: string;
  inputFingerprint: string;
  compositionDigest: string;
  now: string;
  adapterKind: 'command' | 'service' | 'browser' | 'attached';
}

export function canReuseReceipt(receipt: EvidenceReceipt, request: ReceiptReuseRequest): boolean {
  if (receipt.compositionDigest !== request.compositionDigest) return false;
  if (request.adapterKind !== 'command') return false;
  if (!receipt.adapter.startsWith('command/')) return false;
  if (receipt.nodeId !== request.nodeId || receipt.inputFingerprint !== request.inputFingerprint) {
    return false;
  }
  if (
    receipt.status !== 'passed' ||
    receipt.trust !== 'verified' ||
    receipt.freshness === 'superseded' ||
    !receipt.validUntil
  ) {
    return false;
  }
  return Date.parse(receipt.validUntil) >= Date.parse(request.now);
}

export function reuseReceipt(input: {
  receipt: EvidenceReceipt;
  attemptId: string;
  startedAt: string;
  completedAt: string;
}): EvidenceReceipt {
  const base = {
    ...structuredClone(input.receipt),
    attemptId: input.attemptId,
    freshness: 'reused' as const,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    sourceReceiptId: input.receipt.receiptId,
  };
  return createEvidenceReceipt(
    base,
    input.receipt.dependencies.dependencies,
    input.receipt.dependencies.dependsOnEvidenceIds,
  );
}
