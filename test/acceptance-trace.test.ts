import { describe, expect, it } from 'vitest';

import { createAcceptanceTrace } from '../domains/evidence/acceptance-trace.js';
import type {
  EvidenceAcceptanceContext,
  EvidenceCheck,
  EvidenceReceipt,
} from '../domains/evidence/types.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const acceptanceId = `acceptance-${'a'.repeat(64)}` as const;
const context: EvidenceAcceptanceContext = {
  verificationInputDigest: digest('1'),
  acceptanceSetHash: digest('2'),
  acceptanceIds: [acceptanceId],
  acceptanceCoverage: [{ acceptanceId, nodeIds: ['e2e', 'typecheck'] }],
};

function receipt(nodeId: string, overrides: Partial<EvidenceReceipt> = {}): EvidenceReceipt {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'EvidenceReceipt',
    receiptId: `receipt-${nodeId}`,
    compositionDigest: TEST_COMPOSITION_DIGEST,
    attemptId: 'attempt-1',
    nodeId,
    adapter: 'command/local',
    trust: 'verified',
    freshness: 'fresh',
    status: 'passed',
    inputFingerprint: 'fingerprint-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    artifacts: [],
    findings: [],
    ...overrides,
  };
}

function check(nodeId: string, overrides: Partial<EvidenceCheck> = {}): EvidenceCheck {
  return {
    nodeId,
    required: true,
    status: 'passed',
    trust: 'verified',
    freshness: 'fresh',
    receiptId: `receipt-${nodeId}`,
    ...overrides,
  };
}

describe('Acceptance Trace', () => {
  it('passes only when every bound required node has a current verified Receipt', () => {
    const trace = createAcceptanceTrace({
      context,
      checks: [check('typecheck'), check('e2e')],
      receipts: [receipt('typecheck'), receipt('e2e')],
      inputFingerprint: 'fingerprint-1',
    });
    expect(trace).toMatchObject({
      verificationInputDigest: context.verificationInputDigest,
      acceptanceSetHash: context.acceptanceSetHash,
      total: 1,
      passed: 1,
      failed: 0,
      missing: 0,
      entries: [
        {
          acceptanceId,
          status: 'passed',
          nodeIds: ['e2e', 'typecheck'],
          receiptIds: ['receipt-e2e', 'receipt-typecheck'],
        },
      ],
    });
    expect(trace.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it.each([
    ['observed', check('e2e', { trust: 'observed' }), receipt('e2e', { trust: 'observed' })],
    [
      'superseded',
      check('e2e', { freshness: 'superseded' }),
      receipt('e2e', { freshness: 'superseded' }),
    ],
    ['failed', check('e2e', { status: 'failed' }), receipt('e2e', { status: 'failed' })],
  ] as const)('fails when one bound Receipt is %s', (_case, e2eCheck, e2eReceipt) => {
    const trace = createAcceptanceTrace({
      context,
      checks: [check('typecheck'), e2eCheck],
      receipts: [receipt('typecheck'), e2eReceipt],
      inputFingerprint: 'fingerprint-1',
    });
    expect(trace).toMatchObject({ passed: 0, failed: 1, missing: 0 });
  });

  it('marks blocked or absent evidence as missing and rejects a non-exact coverage set', () => {
    const trace = createAcceptanceTrace({
      context,
      checks: [check('typecheck'), { nodeId: 'e2e', required: true, status: 'blocked' }],
      receipts: [receipt('typecheck')],
      inputFingerprint: 'fingerprint-1',
    });
    expect(trace).toMatchObject({ passed: 0, failed: 0, missing: 1 });
    expect(() =>
      createAcceptanceTrace({
        context: { ...context, acceptanceCoverage: [] },
        checks: [],
        receipts: [],
        inputFingerprint: 'fingerprint-1',
      }),
    ).toThrow(/exactly cover/u);
  });
});
