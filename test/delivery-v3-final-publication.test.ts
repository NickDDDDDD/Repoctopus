import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  DeliveryEvent,
  DeliveryGitPort,
  DeliveryV3StorePort,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import {
  createPostMergePublicationReceiptV2,
  type PostMergePublicationRequestV2,
} from '../domains/delivery/post-merge.js';
import {
  DeliveryServiceV3,
  type ArchiveFinalPublicationProof,
  type ArchivePublicationReceipt,
} from '../domains/delivery/service-v3.js';
import type { DeliveryPolicy, DeliveryStateV3 } from '../domains/delivery/types.js';
import {
  createDefaultDeliveryIntentV3,
  createDeliverySnapshotV3,
  initialDeliveryStateV3,
} from '../domains/delivery/v3.js';
import {
  createPostMergeTargetMergeIntent,
  createPostMergeTargetMergeReceipt,
} from '../domains/post-merge/checkout.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

class MemoryStore implements DeliveryV3StorePort {
  events: DeliveryEvent[] = [];

  constructor(public state: DeliveryStateV3) {}

  load(): Promise<DeliveryStateV3> {
    return Promise.resolve(structuredClone(this.state));
  }

  list(): Promise<DeliveryStateV3[]> {
    return Promise.resolve([structuredClone(this.state)]);
  }

  commit(options: {
    state: DeliveryStateV3;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void> {
    expect(options.previousStateVersion).toBe(this.state.stateVersion);
    this.state = structuredClone(options.state);
    this.events.push(structuredClone(options.event));
    return Promise.resolve();
  }
}

class EmptyStore implements DeliveryV3StorePort {
  load(): Promise<null> {
    return Promise.resolve(null);
  }

  list(): Promise<DeliveryStateV3[]> {
    return Promise.resolve([]);
  }

  commit(): Promise<void> {
    return Promise.reject(new Error('Archive final publication must not create Delivery state'));
  }
}

const unusedGit: DeliveryGitPort = {
  checkpoint: () => Promise.reject(new Error('not used')),
  inspect: () => Promise.reject(new Error('not used')),
  push: () => Promise.reject(new Error('not used')),
};

const unusedMergeRequests: MergeRequestPort = {
  capability: () => Promise.reject(new Error('not used')),
  find: () => Promise.reject(new Error('not used')),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  status: () => Promise.reject(new Error('not used')),
};

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

function fixture() {
  const changeBranch = {
    repositoryId: 'workspace',
    remoteIdentity: 'github.com/team/workspace',
    sourceBranch: 'spec/final-publication',
    targetBranch: 'main',
    remoteOid: '1'.repeat(40),
  };
  const intent = createDefaultDeliveryIntentV3({
    changeId: 'final-publication',
    changeBranch,
    businessDelivery: {
      repositoryId: 'app',
      sourceBranch: 'feat/final-publication',
      targetBranch: 'main',
      commitMessage: 'feat: final publication',
      actions: ['push', 'merge_request'],
    },
  });
  const snapshot = createDeliverySnapshotV3({
    compositionDigest: TEST_COMPOSITION_DIGEST,
    intent,
    policy,
    reportContents: 'verified',
    evidenceBundleIds: ['business-bundle'],
    businessDeliveries: [
      {
        deliveryId: 'primary',
        repositoryId: 'app',
        repositoryName: 'app',
        remoteIdentity: 'github.com/team/app',
        sourceBranch: 'feat/final-publication',
        targetBranch: 'main',
        head: '2'.repeat(40),
        tree: '3'.repeat(40),
        remoteSourceOid: '2'.repeat(40),
        remoteTargetOid: '4'.repeat(40),
        clean: true,
      },
    ],
    createdAt: '2026-10-22T00:00:00.000Z',
  });
  const base = initialDeliveryStateV3(intent.changeId, '2026-10-22T00:00:00.000Z');
  const state: DeliveryStateV3 = {
    ...base,
    stateVersion: 3,
    status: 'merged',
    snapshot,
    businessMergeRequests: [
      {
        deliveryId: 'primary',
        repositoryId: 'app',
        remoteIdentity: 'github.com/team/app',
        sourceBranch: 'feat/final-publication',
        targetBranch: 'main',
        mergeRequest: {
          provider: 'github',
          repositoryId: 'app',
          number: 7,
          url: 'https://github.com/team/app/pull/7',
        },
      },
    ],
  };
  const targetMergeIntent = createPostMergeTargetMergeIntent({
    schemaVersion: 1,
    runId: 'final-publication-run',
    mergeFactsDigest: `sha256:${'a'.repeat(64)}`,
    remote: 'origin',
    changeBranch,
    targetOid: '6'.repeat(40),
  });
  const targetMergeReceipt = createPostMergeTargetMergeReceipt({
    schemaVersion: 1,
    intentDigest: targetMergeIntent.digest,
    repositoryId: 'workspace',
    sourceOid: changeBranch.remoteOid,
    targetOid: targetMergeIntent.targetOid,
    mergeCommitOid: '5'.repeat(40),
    parents: [changeBranch.remoteOid, targetMergeIntent.targetOid],
    checkoutPath: 'C:/managed/final-publication',
  });
  const baselineBase = {
    schemaVersion: 1 as const,
    root: targetMergeReceipt.checkoutPath,
    head: targetMergeReceipt.mergeCommitOid,
    tree: '7'.repeat(40),
  };
  const baseline = { ...baselineBase, digest: sha256(baselineBase) };
  const auditBase = {
    schemaVersion: 1 as const,
    planDigest: `sha256:${'b'.repeat(64)}` as const,
    closureId: `sha256:${'c'.repeat(64)}` as const,
    baselineDigest: baseline.digest,
    changedFiles: ['openspec/changes/archive/final-publication/proposal.md'],
    contentDigests: {
      'openspec/changes/archive/final-publication/proposal.md': `sha256:${'d'.repeat(64)}` as const,
    },
  };
  const request: PostMergePublicationRequestV2 = {
    schemaVersion: 2,
    runId: targetMergeIntent.runId,
    changeId: intent.changeId,
    evidenceBundleId: 'post-merge-bundle',
    workspaceRoot: baseline.root,
    targetMerge: { intent: targetMergeIntent, receipt: targetMergeReceipt },
    baseline,
    audit: { ...auditBase, digest: sha256(auditBase) },
    policy: {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'PostMergePublicationPolicy',
      operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'],
      remote: 'origin',
      commit: {
        message: 'chore(spec): close verified change',
        authorName: 'Repoctopus',
        authorEmail: 'repoctopus@example.invalid',
      },
      mergeRequest: { title: 'Final Change', body: 'Closed and verified.' },
    },
  };
  return { state, request };
}

describe('Delivery v3 final Change publication state', () => {
  it('persists closure and final MR state around the recoverable publisher', async () => {
    const fx = fixture();
    const store = new MemoryStore(fx.state);
    const finalPublication = {
      publish: (request: PostMergePublicationRequestV2) =>
        Promise.resolve(
          createPostMergePublicationReceiptV2({
            request,
            git: {
              commitOid: '8'.repeat(40),
              remoteOid: '8'.repeat(40),
              commitRecovered: false,
              pushRecovered: false,
            },
            mergeRequest: {
              provider: 'github',
              repositoryId: 'workspace',
              number: 9,
              url: 'https://github.com/team/workspace/pull/9',
            },
            mergeRequestRecovered: false,
          }),
        ),
    };
    const service = new DeliveryServiceV3(
      store,
      unusedGit,
      unusedMergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      () => new Date('2026-10-22T01:00:00.000Z'),
      finalPublication,
    );

    const receipt = await service.publishFinalChange(fx.request);

    expect(receipt.mergeRequest.number).toBe(9);
    expect(store.state).toMatchObject({
      status: 'merged',
      closure: {
        status: 'succeeded',
        evidenceBundleId: 'post-merge-bundle',
        specificationClosureId: fx.request.audit.closureId,
        publishedOid: '8'.repeat(40),
      },
      finalChangeMergeRequest: {
        status: 'open',
        mergeRequest: { repositoryId: 'workspace', number: 9 },
      },
    });
    expect(store.events.map((event) => event.data.result)).toEqual([
      'final-change-publication-started',
      'final-change-published',
    ]);
  });

  it('publishes a lifecycle-owned Archive without a parallel Delivery aggregate', async () => {
    const fx = fixture();
    const snapshot = fx.state.snapshot!;
    const mergeRequest = {
      provider: 'github' as const,
      repositoryId: 'app',
      number: 7,
      url: 'https://github.com/team/app/pull/7',
    };
    const receipts: ArchivePublicationReceipt[] = snapshot.plan.map((action) => {
      if (action.type === 'git.push') {
        return {
          actionId: action.actionId,
          deliveryId: action.deliveryId,
          type: action.type,
          status: 'succeeded',
          recovered: false,
          remoteOid: action.expectedHead,
        };
      }
      if (action.type === 'mr.create_or_update') {
        return {
          actionId: action.actionId,
          deliveryId: action.deliveryId,
          type: action.type,
          status: 'succeeded',
          recovered: false,
          mergeRequest,
        };
      }
      throw new Error(`Unexpected fixture action: ${action.type}`);
    });
    const proof: ArchiveFinalPublicationProof = {
      publication: {
        snapshot,
        receipts,
      },
      merge: {
        allMerged: true,
        mergeRequestStatuses: [],
        mergeEvidence: [
          {
            deliveryId: 'primary',
            repositoryId: 'app',
            mergeRequest,
            mergeCommit: '9'.repeat(40),
            mergedAt: '2026-10-22T00:30:00.000Z',
            observedAt: '2026-10-22T00:31:00.000Z',
          },
        ],
        platformCapabilities: [],
      },
    };
    const finalPublication = {
      publish: (request: PostMergePublicationRequestV2) =>
        Promise.resolve(
          createPostMergePublicationReceiptV2({
            request,
            git: {
              commitOid: '8'.repeat(40),
              remoteOid: '8'.repeat(40),
              commitRecovered: false,
              pushRecovered: false,
            },
            mergeRequest: {
              provider: 'github',
              repositoryId: 'workspace',
              number: 9,
              url: 'https://github.com/team/workspace/pull/9',
            },
            mergeRequestRecovered: false,
          }),
        ),
    };
    const service = new DeliveryServiceV3(
      new EmptyStore(),
      unusedGit,
      unusedMergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      undefined,
      finalPublication,
    );

    await expect(service.publishArchiveFinalChange(fx.request, proof)).resolves.toMatchObject({
      mergeRequest: { repositoryId: 'workspace', number: 9 },
    });
    await expect(
      service.publishArchiveFinalChange(fx.request, {
        ...proof,
        merge: { ...proof.merge, allMerged: false },
      }),
    ).rejects.toThrow('requires all frozen Business MRs to be merged');
  });
});
