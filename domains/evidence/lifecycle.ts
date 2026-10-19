import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { EVIDENCE_API_VERSION, type EvidenceReceipt } from './types.js';

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
  const identity = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'receiptId'));
  return {
    ...base,
    apiVersion: EVIDENCE_API_VERSION,
    kind: 'EvidenceReceipt',
    receiptId: createHash('sha256').update(canonicalJson(identity)).digest('hex'),
  };
}
