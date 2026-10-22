import { describe, expect, it } from 'vitest';

import type {
  DeliveryEvent,
  DeliveryGitPort,
  DeliveryStorePort,
  MergeRequestInput,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import { DeliveryService } from '../domains/delivery/service.js';
import { initialDeliveryState } from '../domains/delivery/state.js';
import type {
  DeliveryState,
  MergeRequestIdentity,
  MergeRequestStatus,
} from '../domains/delivery/types.js';

const changeIdentity: MergeRequestIdentity = {
  provider: 'github',
  repositoryId: 'workspace',
  number: 17,
  url: 'https://github.com/example/workspace/pull/17',
};

class MemoryStore implements DeliveryStorePort {
  commits = 0;

  constructor(readonly state: DeliveryState) {}

  load(): Promise<DeliveryState> {
    return Promise.resolve(structuredClone(this.state));
  }

  list(): Promise<DeliveryState[]> {
    return Promise.resolve([structuredClone(this.state)]);
  }

  commit(options: {
    state: DeliveryState;
    previousStateVersion: number | null;
    event: DeliveryEvent;
  }): Promise<void> {
    void options;
    this.commits += 1;
    return Promise.resolve();
  }

  history(): Promise<DeliveryEvent[]> {
    return Promise.resolve([]);
  }

  approvedEvidenceBundleIds(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

class ReadOnlyMergeRequests implements MergeRequestPort {
  statusCalls = 0;
  mutationCalls = 0;

  constructor(readonly authoritative: MergeRequestStatus) {}

  capability() {
    return Promise.resolve({
      name: 'branch-protection' as const,
      status: 'available' as const,
      blocking: false as const,
      diagnosticCode: 'fixture.available',
    });
  }

  find(input: MergeRequestInput): Promise<MergeRequestIdentity | null> {
    void input;
    this.mutationCalls += 1;
    return Promise.resolve(null);
  }

  create(input: MergeRequestInput): Promise<MergeRequestIdentity> {
    void input;
    this.mutationCalls += 1;
    return Promise.reject(new Error('not used'));
  }

  update(): Promise<MergeRequestIdentity> {
    this.mutationCalls += 1;
    return Promise.reject(new Error('not used'));
  }

  status(): Promise<MergeRequestStatus> {
    this.statusCalls += 1;
    return Promise.resolve(structuredClone(this.authoritative));
  }
}

const unusedGit: DeliveryGitPort = {
  checkpoint: () => Promise.reject(new Error('not used')),
  inspect: () => Promise.reject(new Error('not used')),
  push: () => Promise.reject(new Error('not used')),
};

function authoritative(
  state: MergeRequestStatus['state'],
  overrides: Partial<MergeRequestStatus> = {},
): MergeRequestStatus {
  return {
    ...changeIdentity,
    state,
    sourceBranch: 'spec/legacy-change',
    targetBranch: 'main',
    headCommit: 'a'.repeat(40),
    ci: 'passed',
    review: 'approved',
    conversationsResolved: true,
    mergeCommit: state === 'merged' ? 'b'.repeat(40) : null,
    mergedAt: state === 'merged' ? '2026-10-22T01:00:00.000Z' : null,
    ...overrides,
  };
}

function activeState(): DeliveryState {
  const change = {
    role: 'change' as const,
    repositoryId: 'workspace',
    remoteIdentity: 'github.com/example/workspace',
    sourceBranch: 'spec/legacy-change',
    targetBranch: 'main',
    mergeRequest: changeIdentity,
  };
  const business = {
    role: 'business' as const,
    repositoryId: 'app',
    remoteIdentity: 'github.com/example/app',
    sourceBranch: 'feat/legacy-change',
    targetBranch: 'main',
    mergeRequest: {
      provider: 'github',
      repositoryId: 'app',
      number: 23,
      url: 'https://github.com/example/app/pull/23',
    },
  };
  return {
    schemaVersion: 2,
    changeId: 'legacy-change',
    stateVersion: 5,
    status: 'in_review',
    snapshot: {
      schemaVersion: 2,
      changeId: 'legacy-change',
      compositionDigest: `sha256:${'1'.repeat(64)}`,
      digest: `sha256:${'2'.repeat(64)}`,
      reportDigest: `sha256:${'3'.repeat(64)}`,
      policyDigest: `sha256:${'4'.repeat(64)}`,
      intentDigest: `sha256:${'5'.repeat(64)}`,
      evidenceBundleIds: ['legacy-evidence-bundle'],
      repositories: [
        {
          repositoryId: 'app',
          repositoryName: 'app',
          remoteIdentity: 'github.com/example/app',
          sourceBranch: 'feat/legacy-change',
          targetBranch: 'main',
          head: '6'.repeat(40),
          tree: '7'.repeat(40),
          remoteSourceOid: '6'.repeat(40),
          remoteTargetOid: '8'.repeat(40),
          clean: true,
        },
      ],
      mergeRequests: { change, business: [business] },
      plan: [
        {
          actionId: 'push-app',
          type: 'git.push',
          repositoryId: 'app',
          sourceBranch: 'feat/legacy-change',
          targetBranch: 'main',
          expectedHead: '6'.repeat(40),
          expectedRemoteSourceOid: '6'.repeat(40),
          expectedRemoteTargetOid: '8'.repeat(40),
        },
        {
          actionId: 'mr-app',
          type: 'mr.create_or_update',
          repositoryId: 'app',
          sourceBranch: 'feat/legacy-change',
          targetBranch: 'main',
          expectedHead: '6'.repeat(40),
          expectedRemoteSourceOid: '6'.repeat(40),
          expectedRemoteTargetOid: '8'.repeat(40),
        },
      ],
      createdAt: '2026-10-22T00:00:00.000Z',
    },
    decisionRequest: null,
    approval: {
      schemaVersion: 1,
      requestId: 'legacy-approval',
      changeId: 'legacy-change',
      snapshotDigest: `sha256:${'2'.repeat(64)}`,
      decision: 'approve',
      actor: { subject: 'legacy-user', provider: 'fixture', sessionId: 'legacy-session' },
      decidedAt: '2026-10-22T00:01:00.000Z',
    },
    actionResults: [
      { actionId: 'push-app', status: 'succeeded', attempts: 1 },
      { actionId: 'mr-app', status: 'succeeded', attempts: 1, mergeRequest: business.mergeRequest },
    ],
    mergeEvidence: [],
    mergeRequests: { change, business: [business] },
    platformCapabilities: [],
    updatedAt: '2026-10-22T00:02:00.000Z',
  };
}

function service(state: DeliveryState, mergeRequest: ReadOnlyMergeRequests) {
  const store = new MemoryStore(state);
  return {
    store,
    service: new DeliveryService(store, unusedGit, mergeRequest, {
      assertSatisfied: () => Promise.resolve(),
    }),
  };
}

describe('Delivery v2 migration planning', () => {
  it('returns a reprepare plan without querying or mutating the platform for pristine state', async () => {
    const state = initialDeliveryState('legacy-pristine', '2026-10-22T00:00:00.000Z');
    const mergeRequests = new ReadOnlyMergeRequests(authoritative('open'));
    const harness = service(state, mergeRequests);

    const plan = await harness.service.migrationPlan(state.changeId);
    expect(plan).toMatchObject({
      kind: 'DeliveryV2MigrationPlan',
      status: 'reprepare_required',
      diagnostic: 'delivery-v2-reprepare-required',
      legacyChangeMergeRequest: null,
      draft: null,
      approval: {
        reuseLegacyApproval: false,
        reuseLegacyEvidenceBundles: false,
        planningApprovalRequired: true,
        deliveryApprovalRequired: true,
      },
      platformMutations: [],
    });
    expect(mergeRequests.statusCalls).toBe(0);
    expect(mergeRequests.mutationCalls).toBe(0);
    expect(harness.store.commits).toBe(0);
  });

  it('builds a v3 draft when approval was prepared but no remote action was attempted', async () => {
    const state = activeState();
    state.status = 'awaiting_approval';
    state.approval = null;
    state.actionResults = state.actionResults.map((action) => ({
      actionId: action.actionId,
      status: 'pending',
      attempts: 0,
    }));
    state.mergeRequests!.business[0]!.mergeRequest = null;
    state.snapshot!.mergeRequests.business[0]!.mergeRequest = null;
    const mergeRequests = new ReadOnlyMergeRequests(authoritative('open'));
    const harness = service(state, mergeRequests);

    const plan = await harness.service.migrationPlan(state.changeId);
    expect(plan).toMatchObject({
      status: 'reprepare_required',
      diagnostic: 'delivery-v2-reprepare-required',
      legacyChangeMergeRequest: { state: 'open' },
      draft: {
        schemaVersion: 3,
        changeBranch: { remoteOid: 'a'.repeat(40) },
        businessDeliveries: [{ deliveryId: 'primary', commitMessage: null }],
      },
      approval: { reuseLegacyApproval: false, reuseLegacyEvidenceBundles: false },
      platformMutations: [],
    });
    expect(plan.requiredActions).toEqual(
      expect.arrayContaining([
        'decide-whether-to-retain-or-close-legacy-change-merge-request',
        'obtain-new-planning-approval',
        'obtain-new-delivery-approval',
      ]),
    );
    expect(mergeRequests.statusCalls).toBe(1);
    expect(mergeRequests.mutationCalls).toBe(0);
    expect(harness.store.commits).toBe(0);
  });

  it('requires a human decision for an open legacy Change MR and never reuses approval', async () => {
    const state = activeState();
    const mergeRequests = new ReadOnlyMergeRequests(authoritative('open'));
    const harness = service(state, mergeRequests);
    const plan = await harness.service.migrationPlan(state.changeId);

    expect(plan).toMatchObject({
      status: 'manual_decision_required',
      diagnostic: 'delivery-v2-open-change-merge-request',
      legacyChangeMergeRequest: {
        identity: changeIdentity,
        state: 'open',
        headCommit: 'a'.repeat(40),
      },
      draft: {
        schemaVersion: 3,
        changeBranch: { remoteOid: 'a'.repeat(40) },
        businessDeliveries: [
          {
            deliveryId: 'primary',
            repositoryId: 'app',
            commitMessage: null,
            actions: ['push', 'merge_request'],
            recordedTargetOid: '8'.repeat(40),
            legacyMergeRequest: {
              provider: 'github',
              repositoryId: 'app',
              number: 23,
            },
          },
        ],
        missingFields: ['businessDeliveries.primary.commitMessage'],
      },
      approval: { reuseLegacyApproval: false, reuseLegacyEvidenceBundles: false },
      platformMutations: [],
    });
    expect(plan).not.toHaveProperty('approval.requestId');
    expect(plan).not.toHaveProperty('draft.evidenceBundleIds');
    expect(mergeRequests.statusCalls).toBe(1);
    expect(mergeRequests.mutationCalls).toBe(0);
    expect(harness.store.commits).toBe(0);
  });

  it.each(['closed', 'merged'] as const)(
    'returns repair_required when the legacy Change MR is %s',
    async (remoteState) => {
      const state = activeState();
      const mergeRequests = new ReadOnlyMergeRequests(authoritative(remoteState));
      const harness = service(state, mergeRequests);

      await expect(harness.service.migrationPlan(state.changeId)).resolves.toMatchObject({
        status: 'repair_required',
        diagnostic: 'delivery-v2-change-merge-request-repair-required',
        legacyChangeMergeRequest: { state: remoteState },
        draft: {
          changeBranch: { remoteOid: 'a'.repeat(40) },
          businessDeliveries: [
            {
              deliveryId: 'primary',
              repositoryId: 'app',
              recordedTargetOid: '8'.repeat(40),
              legacyMergeRequest: { number: 23 },
            },
          ],
        },
        platformMutations: [],
      });
      expect(mergeRequests.statusCalls).toBe(1);
      expect(mergeRequests.mutationCalls).toBe(0);
      expect(harness.store.commits).toBe(0);
    },
  );

  it('fails closed into repair_required when the authoritative branch mapping drifted', async () => {
    const state = activeState();
    const mergeRequests = new ReadOnlyMergeRequests(
      authoritative('open', { sourceBranch: 'spec/replaced-legacy-change' }),
    );
    const harness = service(state, mergeRequests);

    const plan = await harness.service.migrationPlan(state.changeId);
    expect(plan).toMatchObject({
      status: 'repair_required',
      draft: {
        changeBranch: { remoteOid: null },
      },
    });
    expect(plan.draft?.missingFields).toContain('changeBranch.remoteOid');
    expect(mergeRequests.mutationCalls).toBe(0);
    expect(harness.store.commits).toBe(0);
  });
});
