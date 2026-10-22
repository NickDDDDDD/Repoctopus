import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import type {
  DeliveryEvent,
  DeliveryGitPort,
  MergeRequestPort,
} from '../../domains/delivery/ports.js';
import { DeliveryServiceV3 } from '../../domains/delivery/service-v3.js';
import type {
  DeliveryStateV3,
  MergeRequestIdentity,
  MergeRequestStatus,
} from '../../domains/delivery/types.js';
import { coordinatePostMerge } from '../../domains/post-merge/coordinator.js';
import {
  postMergeProjectSnapshot,
  postMergeRunOptions,
  postMergeTriggerFacts,
} from '../../domains/post-merge/run.js';
import { WorkflowRunCoordinator } from '../../domains/runtime/workflow-runs.js';
import { parseWorkflowPackage } from '../../domains/workflow-contract/package.js';
import { FileDeliveryV3Store } from '../../platform/delivery/file-delivery-v3-store.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';

const productRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const unusedGit: DeliveryGitPort = {
  checkpoint: () => Promise.reject(new Error('not used')),
  inspect: () => Promise.reject(new Error('not used')),
  push: () => Promise.reject(new Error('not used')),
};

class AuthoritativeMergeRequests implements MergeRequestPort {
  constructor(private readonly statuses: Map<number, MergeRequestStatus>) {}

  capability() {
    return Promise.resolve({
      name: 'branch-protection' as const,
      status: 'available' as const,
      blocking: false as const,
      diagnosticCode: 'fixture.branch-protection.available',
    });
  }

  find(): Promise<MergeRequestIdentity | null> {
    return Promise.reject(new Error('not used'));
  }

  create(): Promise<MergeRequestIdentity> {
    return Promise.reject(new Error('not used'));
  }

  update(): Promise<MergeRequestIdentity> {
    return Promise.reject(new Error('not used'));
  }

  status(identity: MergeRequestIdentity): Promise<MergeRequestStatus> {
    const status = this.statuses.get(identity.number);
    if (!status) return Promise.reject(new Error(`Missing MR status: ${identity.number}`));
    return Promise.resolve(structuredClone(status));
  }
}

function deliveryState(compositionDigest: string): DeliveryStateV3 {
  const changeId = 'multi-business-post-merge';
  const remoteIdentity = 'github.com/example/app';
  const deliveries = [
    {
      deliveryId: 'primary',
      sourceBranch: 'feat/multi-business',
      head: '1'.repeat(40),
      number: 41,
    },
    {
      deliveryId: 'supplemental',
      sourceBranch: 'fix/multi-business-follow-up',
      head: '2'.repeat(40),
      number: 42,
    },
  ];
  return {
    schemaVersion: 3,
    changeId,
    stateVersion: 1,
    status: 'in_review',
    snapshot: {
      schemaVersion: 3,
      changeId,
      compositionDigest,
      digest: `sha256:${'1'.repeat(64)}`,
      reportDigest: `sha256:${'2'.repeat(64)}`,
      policyDigest: `sha256:${'3'.repeat(64)}`,
      intentDigest: `sha256:${'4'.repeat(64)}`,
      evidenceBundleIds: [`sha256:${'5'.repeat(64)}`],
      changeBranch: {
        repositoryId: 'workspace',
        remoteIdentity: 'github.com/example/workspace',
        sourceBranch: 'spec/multi-business-post-merge',
        targetBranch: 'main',
        remoteOid: 'a'.repeat(40),
      },
      businessDeliveries: deliveries.map((delivery) => ({
        deliveryId: delivery.deliveryId,
        repositoryId: 'app',
        repositoryName: 'app',
        remoteIdentity,
        sourceBranch: delivery.sourceBranch,
        targetBranch: 'main',
        head: delivery.head,
        tree: 'b'.repeat(40),
        remoteSourceOid: delivery.head,
        remoteTargetOid: 'c'.repeat(40),
        clean: true,
      })),
      businessSplitReason: {
        kind: 'supplemental_fix',
        summary: 'A separately reviewed fix is required before closure.',
      },
      plan: [],
      createdAt: '2026-10-22T00:00:00.000Z',
    },
    decisionRequest: null,
    approval: null,
    actionResults: [],
    businessMergeRequests: deliveries.map((delivery) => ({
      deliveryId: delivery.deliveryId,
      repositoryId: 'app',
      remoteIdentity,
      sourceBranch: delivery.sourceBranch,
      targetBranch: 'main',
      mergeRequest: {
        provider: 'github',
        repositoryId: 'app',
        number: delivery.number,
        url: `https://github.com/example/app/pull/${delivery.number}`,
      },
    })),
    mergeEvidence: [],
    closure: null,
    finalChangeMergeRequest: null,
    platformCapabilities: [],
    updatedAt: '2026-10-22T00:00:00.000Z',
  };
}

function mergedStatus(input: {
  number: number;
  sourceBranch: string;
  headCommit: string;
  mergeCommit: string;
  mergedAt: string;
}): MergeRequestStatus {
  return {
    provider: 'github',
    repositoryId: 'app',
    number: input.number,
    url: `https://github.com/example/app/pull/${input.number}`,
    state: 'merged',
    sourceBranch: input.sourceBranch,
    targetBranch: 'main',
    headCommit: input.headCommit,
    ci: 'passed',
    review: 'approved',
    conversationsResolved: true,
    mergeCommit: input.mergeCommit,
    mergedAt: input.mergedAt,
  };
}

it('carries every authoritative same-repository Business MR merge into one Post-merge Run', async () => {
  const root = await temporaryDirectory('repoctopus-multi-business-e2e-');
  cleanup.push(root);
  const composition = compositionFixture();
  const state = deliveryState(composition.compositionDigest);
  const deliveryStore = new FileDeliveryV3Store(root);
  const event: DeliveryEvent = {
    schemaVersion: 1,
    eventId: 'multi-business-delivery-ready',
    changeId: state.changeId,
    stateVersion: state.stateVersion,
    timestamp: state.updatedAt,
    type: 'delivery.action',
    data: {},
  };
  await deliveryStore.commit({ state, previousStateVersion: null, event });

  const primaryMerge = '3'.repeat(40);
  const supplementalMerge = '4'.repeat(40);
  const mergeRequests = new AuthoritativeMergeRequests(
    new Map([
      [
        41,
        mergedStatus({
          number: 41,
          sourceBranch: 'feat/multi-business',
          headCommit: '1'.repeat(40),
          mergeCommit: primaryMerge,
          mergedAt: '2026-10-22T00:10:00.000Z',
        }),
      ],
      [
        42,
        mergedStatus({
          number: 42,
          sourceBranch: 'fix/multi-business-follow-up',
          headCommit: '2'.repeat(40),
          mergeCommit: supplementalMerge,
          mergedAt: '2026-10-22T00:20:00.000Z',
        }),
      ],
    ]),
  );
  const delivery = new DeliveryServiceV3(
    deliveryStore,
    unusedGit,
    mergeRequests,
    { assertSatisfied: () => Promise.resolve() },
    composition.compositionDigest,
    () => new Date('2026-10-22T00:30:00.000Z'),
  );

  const refresh = await delivery.refreshForMergeRequest({
    provider: 'github',
    remoteIdentity: 'github.com/example/app',
    number: 42,
  });
  const coordination = coordinatePostMerge(refresh);
  expect(coordination).toMatchObject({
    status: 'ready',
    mergeEvidence: [
      { mergeRequest: { number: 41 }, mergeCommit: primaryMerge },
      { mergeRequest: { number: 42 }, mergeCommit: supplementalMerge },
    ],
    repositories: [{ repositoryId: 'app', mergeCommit: supplementalMerge }],
  });
  if (coordination.status !== 'ready') throw new Error('Expected ready coordination');

  const workflowSource = path.join(productRoot, 'workflows', 'post-merge.yaml');
  const workflow = parseWorkflowPackage(await readFile(workflowSource, 'utf8'));
  const options = postMergeRunOptions({
    coordination,
    workflow,
    projectSnapshot: postMergeProjectSnapshot({
      coordination,
      projectId: 'multi-business-e2e',
      root,
      sources: [{ repositoryId: 'app', path: path.join(root, 'app') }],
      capturedAt: '2026-10-22T00:30:00.000Z',
    }),
    workflowSource,
  });
  const runStore = new FileRuntimeStore(root);
  const runtime = new WorkflowRunCoordinator(
    runStore,
    { async export() {} },
    composition,
    () => new Date('2026-10-22T00:30:01.000Z'),
  );
  await runtime.startOrResume(options);

  const persisted = await runStore.loadRun(options.runId);
  expect(postMergeTriggerFacts(persisted.trigger)).toEqual({
    changeId: state.changeId,
    changeBranch: state.snapshot!.changeBranch,
    mergeEvidence: [
      {
        repositoryId: 'app',
        mergeRequest: state.businessMergeRequests[0]!.mergeRequest,
        mergeCommit: primaryMerge,
        mergedAt: '2026-10-22T00:10:00.000Z',
      },
      {
        repositoryId: 'app',
        mergeRequest: state.businessMergeRequests[1]!.mergeRequest,
        mergeCommit: supplementalMerge,
        mergedAt: '2026-10-22T00:20:00.000Z',
      },
    ],
    repositories: [
      {
        repositoryId: 'app',
        remoteIdentity: 'github.com/example/app',
        targetBranch: 'main',
        mergeCommit: supplementalMerge,
      },
    ],
  });
});
