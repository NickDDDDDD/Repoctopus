import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  DeliveryEvent,
  DeliveryGitPort,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import { DeliveryService } from '../domains/delivery/service.js';
import { initialDeliveryState } from '../domains/delivery/state.js';
import type {
  DeliveryMergeRequestSet,
  DeliveryPolicy,
  DeliveryState,
  MergeRequestIdentity,
  MergeRequestReference,
  MergeRequestStatus,
} from '../domains/delivery/types.js';
import { deliveryEnvelope } from '../domains/platform-events/inbox.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import { githubPullRequestReference } from '../platform/github/pull-request-event.js';
import { createGitHubPostMergeProcessor } from '../plugins/events/github-post-merge-contributor.js';
import { Delivery } from '../services/delivery.js';
import { PostMergeCoordinator } from '../services/post-merge-coordinator.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

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

const references = {
  app: { provider: 'github', remoteIdentity: 'github.com/team/app', number: 11 },
  api: { provider: 'github', remoteIdentity: 'github.com/team/api', number: 12 },
} satisfies Record<string, MergeRequestReference>;

function mergeRequest(
  repositoryId: string,
  remoteIdentity: string,
  number: number,
): DeliveryMergeRequestSet['business'][number] {
  return {
    role: 'business',
    repositoryId,
    remoteIdentity,
    sourceBranch: 'feat/change',
    targetBranch: 'main',
    mergeRequest: {
      provider: 'github',
      repositoryId,
      number,
      url: `https://${remoteIdentity}/pull/${number}`,
    },
  };
}

function activeState(changeId = 'post-merge-change'): DeliveryState {
  return {
    ...initialDeliveryState(changeId, '2026-01-01T00:00:00.000Z'),
    stateVersion: 1,
    status: 'in_review',
    mergeRequests: {
      coordination: {
        role: 'coordination',
        repositoryId: 'coordination-repository',
        remoteIdentity: 'github.com/team/coordination-repository',
        sourceBranch: `feat/${changeId}`,
        targetBranch: 'main',
        mergeRequest: {
          provider: 'github',
          repositoryId: 'coordination-repository',
          number: 8,
          url: 'https://github.com/team/coordination-repository/pull/8',
        },
      },
      business: [
        mergeRequest('app', references.app.remoteIdentity, references.app.number),
        mergeRequest('api', references.api.remoteIdentity, references.api.number),
      ],
    },
  };
}

function event(state: DeliveryState): DeliveryEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${state.changeId}`,
    changeId: state.changeId,
    stateVersion: state.stateVersion,
    timestamp: state.updatedAt,
    type: 'delivery.action',
    data: {},
  };
}

type AuthoritativeState = MergeRequestStatus['state'];

class MockGitHub implements MergeRequestPort {
  readonly calls: string[] = [];

  constructor(readonly states: Map<string, AuthoritativeState>) {}

  capability() {
    return Promise.resolve({
      name: 'branch-protection' as const,
      status: 'available' as const,
      blocking: false as const,
      diagnosticCode: 'available',
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
    this.calls.push(identity.repositoryId);
    const state = this.states.get(identity.repositoryId);
    if (!state) return Promise.reject(new Error(`Missing mock state: ${identity.repositoryId}`));
    const merged = state === 'merged';
    return Promise.resolve({
      ...identity,
      state,
      ci: 'passed',
      review: 'approved',
      conversationsResolved: true,
      mergeCommit: merged ? `merge-${identity.repositoryId}` : null,
      mergedAt: merged ? '2026-01-01T00:01:00.000Z' : null,
    });
  }
}

const unusedGit: DeliveryGitPort = {
  checkpoint: () => Promise.reject(new Error('not used')),
  inspect: () => Promise.reject(new Error('not used')),
  push: () => Promise.reject(new Error('not used')),
};

class TestDelivery extends Delivery {
  constructor(
    context: Context,
    private readonly domain: DeliveryService,
  ) {
    super(context);
  }

  checkpoint(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  prepare(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  status(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  decide(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  publish(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  refresh(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  refreshForMergeRequest(reference: MergeRequestReference) {
    return this.domain.refreshForMergeRequest(reference);
  }

  override reconciliationCandidates() {
    return this.domain.reconciliationCandidates();
  }
}

async function harness(states: Record<string, AuthoritativeState>, changeId = 'post-merge-change') {
  const root = await temporaryDirectory('repoctopus-post-merge-');
  cleanup.push(root);
  const store = new FileDeliveryStore(root);
  const state = activeState(changeId);
  await store.commit({ state, previousStateVersion: null, event: event(state) });
  const github = new MockGitHub(new Map(Object.entries(states)));
  const domain = new DeliveryService(
    store,
    unusedGit,
    github,
    { assertSatisfied: () => Promise.resolve() },
    () => new Date('2026-01-01T00:02:00.000Z'),
  );
  const context = new Context();
  new TestDelivery(context, domain);
  const coordinator = new PostMergeCoordinator(context, { policy });
  return { context, coordinator, github, store };
}

describe('post-merge coordinator', () => {
  it('re-reads every business MR and distinguishes partial merge from closed unmerged', async () => {
    const partial = await harness({ app: 'merged', api: 'open' }, 'partial-change');
    await expect(partial.coordinator.wake(references.app)).resolves.toEqual({
      status: 'waiting',
      diagnostic: 'post-merge-business-merge-requests-open',
      changeId: 'partial-change',
      mergedCount: 1,
      totalCount: 2,
    });
    expect(partial.github.calls).toEqual(['app', 'api']);
    await partial.context.fiber.dispose();

    const closed = await harness({ app: 'merged', api: 'closed' }, 'closed-change');
    await expect(closed.coordinator.wake(references.api)).resolves.toEqual({
      status: 'blocked',
      diagnostic: 'post-merge-business-merge-request-closed',
      changeId: 'closed-change',
      repositoryIds: ['api'],
    });
    expect((await closed.store.load('closed-change'))?.status).toBe('in_review');
    await closed.context.fiber.dispose();
  });

  it('becomes ready on the final merge and reproduces stable facts for recovery', async () => {
    const ready = await harness({ app: 'merged', api: 'open' }, 'ready-change');
    await expect(ready.coordinator.wake(references.app)).resolves.toMatchObject({
      status: 'waiting',
      mergedCount: 1,
      totalCount: 2,
    });
    ready.github.states.set('api', 'merged');
    const final = await ready.coordinator.wake(references.api);
    expect(final).toMatchObject({
      status: 'ready',
      diagnostic: 'post-merge-ready',
      changeId: 'ready-change',
      mergeEvidence: [{ mergeCommit: 'merge-app' }, { mergeCommit: 'merge-api' }],
    });
    expect(final.status === 'ready' && final.mergeFactsDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await ready.store.load('ready-change'))?.status).toBe('merged');
    await expect(ready.coordinator.wake(references.api)).resolves.toMatchObject({
      status: 'ready',
      diagnostic: 'post-merge-ready',
      changeId: 'ready-change',
      mergeFactsDigest: final.status === 'ready' ? final.mergeFactsDigest : undefined,
    });
    expect(ready.github.calls).toEqual(['app', 'api', 'app', 'api', 'app', 'api']);
    await ready.context.fiber.dispose();
  });

  it('enumerates project candidates without using MR authors and isolates reconciliation failures', async () => {
    const first = await harness({ app: 'merged', api: 'open' }, 'alpha-change');
    const secondState = activeState('beta-change');
    secondState.mergeRequests!.business[0]!.mergeRequest!.number = 21;
    secondState.mergeRequests!.business[1]!.mergeRequest!.number = 22;
    await first.store.commit({
      state: secondState,
      previousStateVersion: null,
      event: event(secondState),
    });

    await expect(first.context.delivery.reconciliationCandidates()).resolves.toEqual([
      { changeId: 'alpha-change', reference: references.app },
      {
        changeId: 'beta-change',
        reference: { ...references.app, number: 21 },
      },
    ]);

    let attempts = 0;
    const original = first.coordinator.execute.bind(first.coordinator);
    first.coordinator.execute = async (reference, signal) => {
      attempts += 1;
      if (attempts === 2) throw new Error('isolated failure');
      return original(reference, signal);
    };
    await expect(first.coordinator.reconcile()).resolves.toEqual({
      checked: 2,
      completed: 0,
      waiting: 1,
      blocked: 0,
      failed: 1,
      items: [
        expect.objectContaining({
          status: 'waiting',
          candidateChangeId: 'alpha-change',
        }),
        {
          status: 'failed',
          diagnostic: 'post-merge-reconciliation-failed',
          candidateChangeId: 'beta-change',
        },
      ],
    });
    await first.context.fiber.dispose();
  });

  it('uses authoritative state for out-of-order events and produces one stable facts digest', async () => {
    const laterFirst = await harness({ app: 'merged', api: 'merged' }, 'ordered-change');
    const laterResult = await laterFirst.coordinator.wake(references.api);
    await expect(laterFirst.coordinator.wake(references.app)).resolves.toMatchObject({
      status: 'ready',
      mergeFactsDigest: laterResult.status === 'ready' ? laterResult.mergeFactsDigest : undefined,
    });
    await laterFirst.context.fiber.dispose();

    const earlierFirst = await harness({ app: 'merged', api: 'merged' }, 'ordered-change');
    const earlierResult = await earlierFirst.coordinator.wake(references.app);
    expect(laterResult.status).toBe('ready');
    expect(earlierResult.status).toBe('ready');
    if (laterResult.status === 'ready' && earlierResult.status === 'ready') {
      expect(laterResult.mergeFactsDigest).toBe(earlierResult.mergeFactsDigest);
    }
    await earlierFirst.context.fiber.dispose();
  });

  it('extracts identity only and does not trust GitHub payload merge claims', () => {
    const envelope = deliveryEnvelope({
      provider: 'github',
      source: 'primary',
      deliveryId: 'delivery-1',
      eventType: 'pull_request',
      receivedAt: '2026-01-01T00:00:00.000Z',
      payload: {
        action: 'closed',
        repository: { html_url: 'https://GitHub.com/Team/App.git' },
        pull_request: { number: 11, merged: false, state: 'closed' },
      },
    });
    expect(githubPullRequestReference(envelope)).toEqual(references.app);
  });

  it('turns GitHub events into wake-ups with stable retry and dead-letter diagnostics', async () => {
    const envelope = deliveryEnvelope({
      provider: 'github',
      source: 'primary',
      deliveryId: 'delivery-processor',
      eventType: 'pull_request',
      receivedAt: '2026-01-01T00:00:00.000Z',
      payload: {
        repository: { html_url: 'https://github.com/team/app' },
        pull_request: { number: 11 },
      },
    });
    const seen: MergeRequestReference[] = [];
    const processor = createGitHubPostMergeProcessor({
      execute(reference) {
        seen.push(reference);
        return Promise.resolve({
          status: 'waiting',
          diagnostic: 'post-merge-business-merge-requests-open',
          changeId: 'post-merge-change',
          mergedCount: 1,
          totalCount: 2,
        });
      },
    });
    await expect(
      processor.process({ envelope, attempt: 1, signal: new AbortController().signal }),
    ).resolves.toEqual({
      result: 'completed',
      diagnostic: 'post-merge-business-merge-requests-open',
    });
    expect(seen).toEqual([references.app]);

    const invalid = { ...envelope, payload: {} };
    await expect(
      processor.process({ envelope: invalid, attempt: 1, signal: new AbortController().signal }),
    ).resolves.toEqual({
      result: 'dead_letter',
      diagnostic: 'github-pull-request-payload-invalid',
    });

    const retrying = createGitHubPostMergeProcessor({
      execute: () => Promise.reject(new Error('temporary platform failure')),
    });
    await expect(
      retrying.process({ envelope, attempt: 1, signal: new AbortController().signal }),
    ).resolves.toEqual({ result: 'retry', diagnostic: 'post-merge-execution-failed' });

    const ambiguous = createGitHubPostMergeProcessor({
      execute: () =>
        Promise.resolve({
          status: 'ambiguous',
          diagnostic: 'delivery-event-ambiguous-match',
          changeIds: ['change-a', 'change-b'],
        }),
    });
    await expect(
      ambiguous.process({ envelope, attempt: 1, signal: new AbortController().signal }),
    ).resolves.toEqual({
      result: 'dead_letter',
      diagnostic: 'delivery-event-ambiguous-match',
    });
  });
});
