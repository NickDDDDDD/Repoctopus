import { describe, expect, it } from 'vitest';

import type {
  DeliveryEvent,
  DeliveryGitPort,
  DeliveryV3StorePort,
  MergeRequestInput,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import { DeliveryServiceV3 } from '../domains/delivery/service-v3.js';
import type {
  DeliveryRepositoryIntent,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliveryStateV3,
  DeliveryIntentV3,
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
} from '../domains/delivery/types.js';
import { createDefaultDeliveryIntentV3 } from '../domains/delivery/v3.js';
import { createProjectSnapshot } from '../domains/project/snapshot.js';
import { coordinatePostMerge } from '../domains/post-merge/coordinator.js';
import type { RepositorySnapshot } from '../domains/project/types.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

class MemoryStore implements DeliveryV3StorePort {
  state: DeliveryStateV3 | null = null;
  events: DeliveryEvent[] = [];

  load(): Promise<DeliveryStateV3 | null> {
    return Promise.resolve(this.state ? structuredClone(this.state) : null);
  }

  list(): Promise<DeliveryStateV3[]> {
    return Promise.resolve(this.state ? [structuredClone(this.state)] : []);
  }

  commit(options: {
    state: DeliveryStateV3;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void> {
    expect(this.state?.stateVersion ?? null).toBe(options.previousStateVersion);
    this.state = structuredClone(options.state);
    this.events.push(structuredClone(options.event));
    return Promise.resolve();
  }
}

class FakeGit implements DeliveryGitPort {
  pushed = false;

  checkpoint(repository: RepositorySnapshot) {
    this.pushed = true;
    return Promise.resolve({
      repositoryId: repository.id,
      created: false,
      head: repository.head,
      checks: [],
      publication: {
        remote: 'origin',
        branch: 'feat/delivery-v3',
        remoteOid: repository.head,
        upstream: 'origin/feat/delivery-v3',
      },
    });
  }

  inspect(
    _repository: RepositorySnapshot,
    delivery: DeliveryRepositoryIntent,
  ): Promise<DeliveryRepositoryFacts> {
    const supplemental = delivery.sourceBranch === 'fix/delivery-v3-follow-up';
    return Promise.resolve({
      repositoryId: 'app',
      repositoryName: 'app',
      remoteIdentity: 'github.com/team/app',
      sourceBranch: delivery.sourceBranch,
      targetBranch: delivery.targetBranch,
      head: (supplemental ? '6' : '2').repeat(40),
      tree: (supplemental ? '7' : '3').repeat(40),
      remoteSourceOid: this.pushed ? (supplemental ? '6' : '2').repeat(40) : null,
      remoteTargetOid: '4'.repeat(40),
      clean: true,
    });
  }

  push(_repository: RepositorySnapshot, action: { expectedHead: string }): Promise<string> {
    this.pushed = true;
    return Promise.resolve(action.expectedHead);
  }
}

class FakeMergeRequests implements MergeRequestPort {
  readonly inputs: MergeRequestInput[] = [];
  readonly identity: MergeRequestIdentity = {
    provider: 'github',
    repositoryId: 'app',
    number: 7,
    url: 'https://github.com/team/app/pull/7',
  };
  authoritativeState: MergeRequestStatus['state'] = 'open';
  readonly authoritativeStates = new Map<number, MergeRequestStatus['state']>();

  capability(): Promise<PlatformCapability> {
    return Promise.resolve({
      name: 'branch-protection',
      status: 'available',
      blocking: false,
      diagnosticCode: 'available',
    });
  }

  find(input: MergeRequestInput): Promise<MergeRequestIdentity | null> {
    this.inputs.push(structuredClone(input));
    return Promise.resolve(null);
  }

  create(input: MergeRequestInput): Promise<MergeRequestIdentity> {
    this.inputs.push(structuredClone(input));
    return Promise.resolve({
      ...this.identity,
      number: input.sourceBranch === 'fix/delivery-v3-follow-up' ? 8 : 7,
      url: `https://github.com/team/app/pull/${input.sourceBranch === 'fix/delivery-v3-follow-up' ? 8 : 7}`,
    });
  }

  update(): Promise<MergeRequestIdentity> {
    throw new Error('not used');
  }

  status(identity: MergeRequestIdentity): Promise<MergeRequestStatus> {
    const state = this.authoritativeStates.get(identity.number) ?? this.authoritativeState;
    const supplemental = identity.number === 8;
    const merged = state === 'merged';
    return Promise.resolve({
      ...identity,
      state,
      sourceBranch: supplemental ? 'fix/delivery-v3-follow-up' : 'feat/delivery-v3',
      targetBranch: 'main',
      headCommit: (supplemental ? '6' : '2').repeat(40),
      title: 'delivery-v3-service',
      body: 'verified',
      ci: 'passed',
      review: 'approved',
      conversationsResolved: true,
      mergeCommit: merged ? (supplemental ? '8' : '5').repeat(40) : null,
      mergedAt: merged ? '2026-10-22T00:30:00.000Z' : null,
    });
  }
}

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

const intent = createDefaultDeliveryIntentV3({
  changeId: 'delivery-v3-service',
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'github.com/team/workspace',
    sourceBranch: 'spec/delivery-v3-service',
    targetBranch: 'main',
    remoteOid: '1'.repeat(40),
  },
  businessDelivery: {
    repositoryId: 'app',
    sourceBranch: 'feat/delivery-v3',
    targetBranch: 'main',
    commitMessage: 'feat: implement delivery v3',
    actions: ['push', 'merge_request'],
  },
});

function multipleIntent(): DeliveryIntentV3 {
  return {
    ...intent,
    businessDeliveries: [
      intent.businessDeliveries[0]!,
      {
        ...intent.businessDeliveries[0]!,
        deliveryId: 'supplemental',
        sourceBranch: 'fix/delivery-v3-follow-up',
        commitMessage: 'feat: add the approved supplemental fix',
      },
    ],
    businessSplitReason: {
      kind: 'supplemental_fix',
      summary: 'The follow-up needs independent review and merge evidence.',
    },
  };
}

const project = createProjectSnapshot({
  schemaVersion: 1,
  projectId: 'delivery-v3',
  root: '/project/workspace',
  capturedAt: '2026-10-22T00:00:00.000Z',
  repositories: [
    {
      id: 'workspace',
      name: 'workspace',
      path: '/project/workspace',
      remoteIdentity: 'github.com/team/workspace',
      branch: 'spec/delivery-v3-service',
      head: '1'.repeat(40),
      worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
    },
    {
      id: 'app',
      name: 'app',
      path: '/project/app',
      remoteIdentity: 'github.com/team/app',
      branch: 'feat/delivery-v3',
      head: '2'.repeat(40),
      worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
    },
  ],
  diagnostics: [],
});

describe('DeliveryServiceV3', () => {
  it('publishes Archive actions without a second approval and recovers lost responses', async () => {
    class ResponseLossGit extends FakeGit {
      override push(_repository: RepositorySnapshot, action: { expectedHead: string }) {
        this.pushed = true;
        return Promise.reject(new Error(`push response lost after ${action.expectedHead}`));
      }
    }
    class ResponseLossMergeRequests extends FakeMergeRequests {
      created: MergeRequestIdentity | null = null;

      override find(input: MergeRequestInput): Promise<MergeRequestIdentity | null> {
        this.inputs.push(structuredClone(input));
        return Promise.resolve(this.created);
      }

      override create(input: MergeRequestInput): Promise<MergeRequestIdentity> {
        this.inputs.push(structuredClone(input));
        this.created = structuredClone(this.identity);
        return Promise.reject(new Error('MR create response lost'));
      }
    }
    const service = new DeliveryServiceV3(
      new MemoryStore(),
      new ResponseLossGit(),
      new ResponseLossMergeRequests(),
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
    );
    const result = await service.publishArchive({
      project,
      intent,
      policy,
      reportContents: 'verification-report:sha256',
      evidenceBundleIds: ['bundle-verified'],
    });
    expect(result.receipts).toMatchObject([
      { type: 'git.push', status: 'succeeded', recovered: true },
      {
        type: 'mr.create_or_update',
        status: 'succeeded',
        recovered: true,
        mergeRequest: { number: 7 },
      },
    ]);
    expect(result.snapshot.plan).toHaveLength(2);
  });

  it('publishes exactly the declared Business MR without reading or creating a Change MR', async () => {
    const store = new MemoryStore();
    const git = new FakeGit();
    const mergeRequests = new FakeMergeRequests();
    const service = new DeliveryServiceV3(
      store,
      git,
      mergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      () => new Date('2026-10-22T00:00:00.000Z'),
    );
    const preparation = {
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: ['bundle-verified'],
    };
    const waiting = await service.prepare(preparation);
    const approved = await service.decide(
      intent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'test', sessionId: 'session' },
    );
    expect(approved.finalChangeMergeRequest).toBeNull();
    const published = await service.publish(preparation);
    expect(published).toMatchObject({
      schemaVersion: 3,
      status: 'in_review',
      businessMergeRequests: [
        { deliveryId: 'primary', repositoryId: 'app', mergeRequest: { number: 7 } },
      ],
      finalChangeMergeRequest: null,
    });
    expect(mergeRequests.inputs).toHaveLength(2);
    expect(mergeRequests.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId: 'app',
          remoteIdentity: 'github.com/team/app',
          sourceBranch: 'feat/delivery-v3',
          targetBranch: 'main',
        }),
      ]),
    );
    expect(mergeRequests.inputs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ repositoryId: 'workspace' })]),
    );
  });

  it('allows the Workspace Repository checkout to move after planning approval', async () => {
    const service = new DeliveryServiceV3(
      new MemoryStore(),
      new FakeGit(),
      new FakeMergeRequests(),
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
    );
    await expect(
      service.prepare({
        project: {
          ...project,
          repositories: project.repositories.map((repository) =>
            repository.id === 'workspace'
              ? { ...repository, branch: 'feat/delivery-v3', head: '9'.repeat(40) }
              : repository,
          ),
        },
        intent,
        policy,
        reportContents: 'verified',
        evidenceBundleIds: ['bundle-verified'],
      }),
    ).resolves.toMatchObject({ schemaVersion: 3, status: 'awaiting_approval' });
  });

  it('publishes two explicitly approved source branches from one repository', async () => {
    const store = new MemoryStore();
    const mergeRequests = new FakeMergeRequests();
    const service = new DeliveryServiceV3(
      store,
      new FakeGit(),
      mergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      () => new Date('2026-10-22T00:20:00.000Z'),
    );
    const multiple = multipleIntent();
    const preparation = {
      project,
      intent: multiple,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: ['bundle-verified'],
    };
    const waiting = await service.prepare(preparation);
    await service.decide(
      multiple.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'test', sessionId: 'session' },
    );

    await expect(service.publish(preparation)).resolves.toMatchObject({
      status: 'in_review',
      businessMergeRequests: [
        { deliveryId: 'primary', repositoryId: 'app', mergeRequest: { number: 7 } },
        { deliveryId: 'supplemental', repositoryId: 'app', mergeRequest: { number: 8 } },
      ],
    });
    expect(
      mergeRequests.inputs.filter((input) => input.sourceBranch === 'feat/delivery-v3'),
    ).toHaveLength(2);
    expect(
      mergeRequests.inputs.filter((input) => input.sourceBranch === 'fix/delivery-v3-follow-up'),
    ).toHaveLength(2);
  });

  it('invalidates approval when a supplemental Business delivery is added later', async () => {
    const store = new MemoryStore();
    const mergeRequests = new FakeMergeRequests();
    const service = new DeliveryServiceV3(
      store,
      new FakeGit(),
      mergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      () => new Date('2026-10-22T00:25:00.000Z'),
    );
    const approvedPreparation = {
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: ['bundle-verified'],
    };
    const waiting = await service.prepare(approvedPreparation);
    await service.decide(
      intent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'test', sessionId: 'session' },
    );

    await expect(
      service.publish({ ...approvedPreparation, intent: multipleIntent() }),
    ).rejects.toThrow(/snapshot drifted.*intent/i);
    expect(store.state).toMatchObject({ status: 'verification_required', approval: null });
    expect(mergeRequests.inputs).toHaveLength(0);
  });

  it('refreshes the full approved collection until the final Business MR merges', async () => {
    const store = new MemoryStore();
    const mergeRequests = new FakeMergeRequests();
    const service = new DeliveryServiceV3(
      store,
      new FakeGit(),
      mergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      () => new Date('2026-10-22T00:30:00.000Z'),
    );
    const multiple = multipleIntent();
    const preparation = {
      project,
      intent: multiple,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: ['bundle-verified'],
    };
    const waiting = await service.prepare(preparation);
    await service.decide(
      multiple.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'test', sessionId: 'session' },
    );
    await service.publish(preparation);
    await expect(service.reconciliationCandidates()).resolves.toEqual([
      {
        changeId: multiple.changeId,
        reference: {
          provider: 'github',
          remoteIdentity: 'github.com/team/app',
          number: 7,
        },
      },
    ]);

    mergeRequests.authoritativeStates.set(7, 'merged');
    mergeRequests.authoritativeStates.set(8, 'open');
    const partial = await service.refresh(multiple.changeId);
    expect(
      coordinatePostMerge({
        match: { status: 'matched', changeIds: [multiple.changeId], diagnostic: null },
        ...partial,
      }),
    ).toMatchObject({
      status: 'waiting',
      diagnostic: 'post-merge-business-merge-requests-open',
      mergedCount: 1,
      totalCount: 2,
    });

    mergeRequests.authoritativeStates.set(8, 'closed');
    const closed = await service.refreshForMergeRequest({
      provider: 'github',
      remoteIdentity: 'github.com/team/app',
      number: 8,
    });
    expect(coordinatePostMerge(closed)).toMatchObject({
      status: 'blocked',
      diagnostic: 'post-merge-business-merge-request-closed',
    });

    mergeRequests.authoritativeStates.set(8, 'merged');
    const complete = await service.refreshForMergeRequest({
      provider: 'github',
      remoteIdentity: 'github.com/team/app',
      number: 8,
    });
    expect(complete.state).toMatchObject({
      status: 'merged',
      mergeEvidence: [
        { deliveryId: 'primary', mergeCommit: '5'.repeat(40) },
        { deliveryId: 'supplemental', mergeCommit: '8'.repeat(40) },
      ],
    });
    expect(coordinatePostMerge(complete)).toMatchObject({
      status: 'ready',
      diagnostic: 'post-merge-ready',
      mergeEvidence: [{ deliveryId: 'primary' }, { deliveryId: 'supplemental' }],
    });
  });

  it('verifies the default Business MR merge commit and exposes the approved Change branch', async () => {
    const store = new MemoryStore();
    const mergeRequests = new FakeMergeRequests();
    const service = new DeliveryServiceV3(
      store,
      new FakeGit(),
      mergeRequests,
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
      () => new Date('2026-10-22T00:40:00.000Z'),
    );
    const preparation = {
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: ['bundle-verified'],
    };
    const waiting = await service.prepare(preparation);
    await service.decide(
      intent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'test', sessionId: 'session' },
    );
    await service.publish(preparation);
    mergeRequests.authoritativeState = 'merged';

    const refresh = await service.refreshForMergeRequest({
      provider: 'github',
      remoteIdentity: 'github.com/team/app',
      number: 7,
    });
    const coordination = coordinatePostMerge(refresh);

    expect(refresh.state).toMatchObject({
      status: 'merged',
      mergeEvidence: [
        {
          deliveryId: 'primary',
          repositoryId: 'app',
          mergeCommit: '5'.repeat(40),
        },
      ],
    });
    expect(coordination).toMatchObject({
      status: 'ready',
      changeId: intent.changeId,
      changeBranch: intent.changeBranch,
      repositories: [{ repositoryId: 'app', mergeCommit: '5'.repeat(40) }],
    });
  });
});
