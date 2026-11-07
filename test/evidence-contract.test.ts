import { createEvidenceReceipt } from '../domains/evidence/receipt.js';
import { describe, expect, it } from 'vitest';

import {
  aggregateGateOutcome,
  createEvidenceBundle,
  projectEvidenceGate,
} from '../domains/evidence/gate.js';
import type { EvidenceReceipt } from '../domains/evidence/types.js';
import { parseEvidenceBundle, parseEvidenceReceipt } from '../domains/evidence/validation.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

const receipt: EvidenceReceipt = createEvidenceReceipt({
  compositionDigest: TEST_COMPOSITION_DIGEST,
  attemptId: 'attempt-1',
  nodeId: 'build',
  adapter: 'command/local',
  trust: 'verified',
  freshness: 'fresh',
  status: 'passed',
  inputFingerprint: 'fingerprint',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  exitCode: 0,
  artifacts: [],
  findings: [],
});

describe('evidence contracts', () => {
  it('round-trips versioned receipts and bundles', () => {
    expect(parseEvidenceReceipt(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
    const bundle = createEvidenceBundle({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      bundleId: 'bundle-1',
      attemptId: 'attempt-1',
      profileId: 'verify',
      inputFingerprint: 'fingerprint',
      createdAt: '2026-01-01T00:00:01.000Z',
      checks: [
        {
          nodeId: 'build',
          required: true,
          status: 'passed',
          trust: 'verified',
          receiptId: 'receipt-1',
        },
      ],
      receiptIds: ['receipt-1'],
      artifactDigests: [],
      findings: [],
    });
    expect(parseEvidenceBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
    expect(projectEvidenceGate(bundle)).toMatchObject({
      kind: 'EvidenceGateProjection',
      status: 'satisfied',
      outcome: 'passed',
      bundleId: bundle.bundleId,
      verificationInputDigest: null,
      acceptanceSetHash: null,
    });
    expect(() => parseEvidenceBundle({ ...bundle, schemaVersion: 1 })).toThrow(/schemaVersion/u);
  });

  it('rejects an unknown major evidence version', () => {
    expect(() => parseEvidenceReceipt({ ...receipt, apiVersion: 'repoctopus/v2alpha1' })).toThrow(
      /unsupported evidence apiVersion/i,
    );
  });

  it('distinguishes failed, incomplete and warning outcomes', () => {
    expect(aggregateGateOutcome([{ nodeId: 'build', required: true, status: 'failed' }], [])).toBe(
      'failed',
    );
    expect(
      aggregateGateOutcome(
        [{ nodeId: 'build', required: true, status: 'passed', trust: 'observed' }],
        [],
      ),
    ).toBe('incomplete');
    expect(
      aggregateGateOutcome(
        [{ nodeId: 'build', required: true, status: 'passed', trust: 'verified' }],
        [{ code: 'notice', severity: 'warning', summary: 'warning' }],
      ),
    ).toBe('passed_with_warnings');
  });
});
