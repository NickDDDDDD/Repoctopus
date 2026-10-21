import { utimes } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import type { DeliveryEvent } from '../domains/delivery/ports.js';
import { createDeliverySnapshot } from '../domains/delivery/snapshot.js';
import {
  initialDeliveryState,
  recordHumanDecision,
  requestDeliveryApproval,
} from '../domains/delivery/state.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
} from '../domains/delivery/types.js';
import { createEvidenceBundle } from '../domains/evidence/gate.js';
import { FileDeliveryEvidence } from '../platform/delivery/file-delivery-evidence.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
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

const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: {
    automatic: true,
    protectedBranches: ['main'],
    commitMessagePattern: '^feat: .+',
    quickChecks: {},
  },
  publication: {
    remote: 'origin',
    provider: 'github',
    githubApiBaseUrl: 'https://api.github.com',
    mrTitleTemplate: '{{changeId}}',
    mrBodyTemplate: '{{verificationReport}}',
  },
};

const intent: DeliveryIntent = {
  schemaVersion: 2,
  changeId: 'delivery-evidence',
  changeMergeRequest: {
    repositoryId: 'workspace-repository',
    remoteIdentity: 'example/workspace-repository',
    sourceBranch: 'feat/delivery-evidence',
    targetBranch: 'main',
    mergeRequest: {
      provider: 'github',
      repositoryId: 'workspace-repository',
      number: 11,
      url: 'https://example.test/workspace-repository/pull/11',
    },
  },
  repositories: [
    {
      repositoryId: 'repo-a',
      sourceBranch: 'feat/change',
      targetBranch: 'main',
      commitMessage: 'feat: change',
      actions: ['push', 'merge_request'],
    },
  ],
};

const facts: DeliveryRepositoryFacts[] = [
  {
    repositoryId: 'repo-a',
    repositoryName: 'repo-a',
    remoteIdentity: 'example/repo-a',
    sourceBranch: 'feat/change',
    targetBranch: 'main',
    head: 'head-a',
    tree: 'tree-a',
    remoteSourceOid: null,
    remoteTargetOid: 'main-a',
    clean: true,
  },
];

function deliveryEvent(stateVersion: number, type: DeliveryEvent['type']): DeliveryEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${stateVersion}`,
    changeId: intent.changeId,
    stateVersion,
    timestamp: `2026-01-01T00:00:0${stateVersion}.000Z`,
    type,
    data: {},
  };
}

describe('delivery evidence closure', () => {
  it('accepts only satisfied bundles and protects an approved bundle during cleanup', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-evidence-');
    cleanup.push(workspace);
    const artifacts = new FileArtifactStore(workspace);
    const evidenceStore = new FileEvidenceStore(workspace);
    const protectedArtifact = await artifacts.put('approved evidence', {
      artifactType: 'log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const orphan = await artifacts.put('orphan evidence', {
      artifactType: 'log',
      mediaType: 'text/plain',
      redacted: true,
    });
    const approvedBundle = createEvidenceBundle({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      bundleId: 'bundle-approved',
      attemptId: 'attempt-approved',
      profileId: 'verify',
      inputFingerprint: 'fingerprint',
      createdAt: '2026-01-01T00:00:00.000Z',
      checks: [],
      receiptIds: [],
      artifactDigests: [protectedArtifact.sha256],
      findings: [],
    });
    const failedBundle = createEvidenceBundle({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      bundleId: 'bundle-failed',
      attemptId: 'attempt-failed',
      profileId: 'verify',
      inputFingerprint: 'fingerprint',
      createdAt: '2026-01-01T00:00:00.000Z',
      checks: [{ nodeId: 'tests', required: true, status: 'failed' }],
      receiptIds: [],
      artifactDigests: [],
      findings: [],
    });
    await evidenceStore.saveBundle(approvedBundle);
    await evidenceStore.saveBundle(failedBundle);
    const deliveryEvidence = new FileDeliveryEvidence(workspace);
    await expect(
      deliveryEvidence.assertSatisfied([approvedBundle.bundleId], TEST_COMPOSITION_DIGEST),
    ).resolves.toBeUndefined();
    await expect(
      deliveryEvidence.assertSatisfied([failedBundle.bundleId], TEST_COMPOSITION_DIGEST),
    ).rejects.toThrow(/does not satisfy/i);
    await expect(
      deliveryEvidence.assertSatisfied([approvedBundle.bundleId], `sha256:${'f'.repeat(64)}`),
    ).rejects.toThrow(/belongs to composition/i);

    const snapshot = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: [approvedBundle.bundleId],
      repositories: facts,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const waiting = requestDeliveryApproval(
      initialDeliveryState(intent.changeId, '2026-01-01T00:00:00.000Z'),
      snapshot,
      '2026-01-01T00:00:01.000Z',
      'request-approved',
    );
    const deliveryStore = new FileDeliveryStore(workspace);
    await deliveryStore.commit({
      state: waiting,
      previousStateVersion: null,
      event: deliveryEvent(waiting.stateVersion, 'delivery.prepared'),
    });
    const approved = recordHumanDecision(
      waiting,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: 'request-approved',
        snapshotDigest: snapshot.digest,
        decision: 'approve',
      },
      { subject: 'human', provider: 'test', sessionId: 'session' },
      '2026-01-01T00:00:02.000Z',
    );
    await deliveryStore.commit({
      state: approved,
      previousStateVersion: waiting.stateVersion,
      event: deliveryEvent(approved.stateVersion, 'delivery.decided'),
    });
    const approvedBundleIds = await deliveryStore.approvedEvidenceBundleIds();
    expect(approvedBundleIds).toEqual([approvedBundle.bundleId]);

    const old = new Date('2000-01-01T00:00:00.000Z');
    await Promise.all([
      utimes(artifacts.objectPath(protectedArtifact.sha256), old, old),
      utimes(artifacts.objectPath(orphan.sha256), old, old),
    ]);
    const result = await new FileEvidenceRetention(workspace).cleanup({
      roots: {
        activeAttemptIds: [],
        acceptedBundleIds: [],
        approvedBundleIds,
        recentSuccessBundleIds: [],
        failureBundleIds: [],
      },
      maxAgeMs: 0,
      maxBytes: 0,
      now: Date.parse('2026-01-02T00:00:00.000Z'),
    });
    expect(result.protected).toContain(protectedArtifact.sha256);
    expect(result.removed).toContain(orphan.sha256);
  });
});
