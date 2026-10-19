import { utimes } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { createEvidenceBundle } from '../domains/evidence/gate.js';
import type { EvidenceAttempt, EvidenceReceipt } from '../domains/evidence/types.js';
import { FileArtifactStore } from '../platform/evidence/file-artifact-store.js';
import { FileEvidenceStore } from '../platform/evidence/file-evidence-store.js';
import { FileEvidenceRetention } from '../platform/evidence/retention.js';
import {
  removeTemporaryDirectory,
  temporaryDirectory,
  TEST_COMPOSITION_DIGEST,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('evidence retention', () => {
  it('protects active and Runtime-accepted evidence closure while deleting old orphans', async () => {
    const workspace = await temporaryDirectory('repoctopus-retention-');
    cleanup.push(workspace);
    const artifacts = new FileArtifactStore(workspace);
    const store = new FileEvidenceStore(workspace);
    const active = await artifacts.put('active', {
      artifactType: 'log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const approved = await artifacts.put('approved', {
      artifactType: 'screenshot',
      mediaType: 'image/png',
      redacted: true,
    });
    const orphan = await artifacts.put('orphan', {
      artifactType: 'log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const receipt: EvidenceReceipt = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'EvidenceReceipt',
      receiptId: 'active-receipt',
      compositionDigest: TEST_COMPOSITION_DIGEST,
      attemptId: 'active-attempt',
      nodeId: 'build',
      adapter: 'command/local',
      trust: 'verified',
      freshness: 'fresh',
      status: 'passed',
      inputFingerprint: 'fingerprint',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      artifacts: [active],
      findings: [],
    };
    await store.saveReceipt(receipt);
    const attempt: EvidenceAttempt = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'EvidenceAttempt',
      attemptId: 'active-attempt',
      compositionDigest: TEST_COMPOSITION_DIGEST,
      profileId: 'verify',
      inputFingerprint: 'fingerprint',
      startedAt: '2026-01-01T00:00:00.000Z',
      receiptIds: [receipt.receiptId],
      status: 'running',
    };
    await store.saveAttempt(attempt);
    const bundle = createEvidenceBundle({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      bundleId: 'approved-bundle',
      attemptId: 'approved-attempt',
      profileId: 'verify',
      inputFingerprint: 'fingerprint',
      createdAt: '2026-01-01T00:00:02.000Z',
      checks: [],
      receiptIds: [],
      artifactDigests: [approved.sha256],
      findings: [],
    });
    await store.saveBundle(bundle);
    const old = new Date('2000-01-01T00:00:00.000Z');
    await utimes(artifacts.objectPath(orphan.sha256), old, old);

    const result = await new FileEvidenceRetention(workspace).cleanup({
      roots: {
        activeAttemptIds: [attempt.attemptId],
        acceptedBundleIds: [bundle.bundleId],
        approvedBundleIds: [],
        recentSuccessBundleIds: [],
        failureBundleIds: [],
      },
      maxAgeMs: 1000,
      maxBytes: 0,
      now: Date.parse('2026-01-01T00:00:00.000Z'),
    });
    expect(result.removed).toEqual([orphan.sha256]);
    expect(result.protected).toEqual([active.sha256, approved.sha256].sort());
    await expect(artifacts.exists(active)).resolves.toBe(true);
    await expect(artifacts.exists(approved)).resolves.toBe(true);
    await expect(artifacts.exists(orphan)).resolves.toBe(false);
  });

  it('defers every deletion while a Runtime transition requires recovery', async () => {
    const workspace = await temporaryDirectory('repoctopus-retention-deferred-');
    cleanup.push(workspace);
    const artifacts = new FileArtifactStore(workspace);
    const orphan = await artifacts.put('orphan', {
      artifactType: 'log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const old = new Date('2000-01-01T00:00:00.000Z');
    await utimes(artifacts.objectPath(orphan.sha256), old, old);

    const result = await new FileEvidenceRetention(workspace).cleanup({
      roots: {
        activeAttemptIds: [],
        acceptedBundleIds: [],
        approvedBundleIds: [],
        recentSuccessBundleIds: [],
        failureBundleIds: [],
      },
      maxAgeMs: 0,
      maxBytes: 0,
      now: Date.parse('2026-01-01T00:00:00.000Z'),
      defer: true,
    });

    expect(result).toMatchObject({ deferred: true, removed: [], bytesAfter: result.bytesBefore });
    await expect(artifacts.exists(orphan)).resolves.toBe(true);
  });
});
