import { afterEach, describe, expect, it } from 'vitest';

import type { DeliveryGitPort, MergeRequestPort } from '../domains/delivery/ports.js';
import { DeliveryService } from '../domains/delivery/service.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
} from '../domains/delivery/types.js';
import type { RepositorySnapshot } from '../domains/project/types.js';
import { createProjectSnapshot } from '../domains/project/snapshot.js';
import { FileDeliveryStore } from '../platform/delivery/file-delivery-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
const evidenceBundleIds = ['bundle-verified'];
const satisfiedEvidence = { assertSatisfied: () => Promise.resolve() };
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
  changeId: 'cross-repo-change',
  coordinationMergeRequest: {
    repositoryId: 'coordination-repository',
    remoteIdentity: 'github.com/team/coordination-repository',
    sourceBranch: 'feat/cross-repo-change',
    targetBranch: 'main',
    mergeRequest: {
      provider: 'github',
      repositoryId: 'coordination-repository',
      number: 99,
      url: 'https://github.com/team/coordination-repository/pull/99',
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
const repository: RepositorySnapshot = {
  id: 'repo-a',
  name: 'app',
  path: '/unused',
  remoteIdentity: 'github.com/team/app',
  branch: 'feat/change',
  head: 'head-a',
  worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
};
const project = createProjectSnapshot({
  schemaVersion: 1,
  projectId: 'project',
  root: '/project',
  capturedAt: '2026-01-01T00:00:00.000Z',
  repositories: [repository],
  diagnostics: [],
});

class FakeGit implements DeliveryGitPort {
  pushed = false;
  pushCalls = 0;
  checkpoint() {
    this.pushed = true;
    return Promise.resolve({
      repositoryId: 'repo-a',
      created: true,
      head: 'head-a',
      checks: [],
      publication: {
        remote: 'origin',
        branch: 'feat/change',
        remoteOid: 'head-a',
        upstream: 'origin/feat/change',
      },
    });
  }
  inspect(): Promise<DeliveryRepositoryFacts> {
    return Promise.resolve({
      repositoryId: 'repo-a',
      repositoryName: 'app',
      remoteIdentity: 'github.com/team/app',
      sourceBranch: 'feat/change',
      targetBranch: 'main',
      head: 'head-a',
      tree: 'tree-a',
      remoteSourceOid: this.pushed ? 'head-a' : null,
      remoteTargetOid: 'main-a',
      clean: true,
    });
  }
  push() {
    this.pushCalls += 1;
    this.pushed = true;
    return Promise.resolve('head-a');
  }
}

class FakeMergeRequests implements MergeRequestPort {
  createCalls = 0;
  failOnce = true;
  merged = false;
  identity: MergeRequestIdentity = {
    provider: 'github',
    repositoryId: 'repo-a',
    number: 1,
    url: 'https://github.com/team/app/pull/1',
  };
  capability(): Promise<PlatformCapability> {
    return Promise.resolve({
      name: 'branch-protection',
      status: 'available',
      blocking: false,
      diagnosticCode: 'available',
    });
  }
  find(): Promise<MergeRequestIdentity | null> {
    return Promise.resolve(this.createCalls > 0 ? this.identity : null);
  }
  create(): Promise<MergeRequestIdentity> {
    this.createCalls += 1;
    if (this.failOnce) {
      this.failOnce = false;
      return Promise.reject(new Error('temporary'));
    }
    return Promise.resolve(this.identity);
  }
  update(): Promise<MergeRequestIdentity> {
    return Promise.resolve(this.identity);
  }
  status(): Promise<MergeRequestStatus> {
    return Promise.resolve({
      ...this.identity,
      state: this.merged ? 'merged' : 'open',
      ci: 'passed',
      review: 'approved',
      conversationsResolved: true,
      mergeCommit: this.merged ? 'merge-a' : null,
      mergedAt: this.merged ? '2026-01-01T00:00:00.000Z' : null,
    });
  }
}

describe('delivery service', () => {
  it('requires one trusted approval, resumes partial publication, and only observes merge', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-service-');
    cleanup.push(workspace);
    const git = new FakeGit();
    const mergeRequests = new FakeMergeRequests();
    let tick = 0;
    const service = new DeliveryService(
      new FileDeliveryStore(workspace),
      git,
      mergeRequests,
      satisfiedEvidence,
      () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000),
    );
    const waiting = await service.prepare({
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    expect(waiting.status).toBe('awaiting_approval');
    await expect(
      service.publish({ project, intent, policy, reportContents: 'verified', evidenceBundleIds }),
    ).rejects.toThrow(/effective approval/i);
    const approved = await service.decide(
      intent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'human', provider: 'test-ui', sessionId: 'session-1' },
    );
    expect(approved.status).toBe('approved');
    await expect(
      service.publish({ project, intent, policy, reportContents: 'verified', evidenceBundleIds }),
    ).rejects.toThrow('temporary');
    expect((await service.status(intent.changeId)).status).toBe('partially_published');
    expect(git.pushCalls).toBe(1);
    const review = await service.publish({
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    expect(review.status).toBe('in_review');
    expect(git.pushCalls).toBe(1);
    expect(mergeRequests.createCalls).toBe(1);
    mergeRequests.merged = true;
    const merged = await service.refresh(intent.changeId);
    expect(merged).toMatchObject({ status: 'merged', mergeEvidence: [{ mergeCommit: 'merge-a' }] });
    const observedAt = merged.mergeEvidence[0]!.observedAt;
    const replayed = await service.refresh(intent.changeId);
    expect(replayed.mergeEvidence[0]!.observedAt).toBe(observedAt);
  });

  it('invalidates approval when report content changes', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-drift-');
    cleanup.push(workspace);
    const service = new DeliveryService(
      new FileDeliveryStore(workspace),
      new FakeGit(),
      new FakeMergeRequests(),
      satisfiedEvidence,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    const waiting = await service.prepare({
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    await service.decide(
      intent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'human', provider: 'test-ui', sessionId: 'session-1' },
    );
    await expect(
      service.publish({ project, intent, policy, reportContents: 'changed', evidenceBundleIds }),
    ).rejects.toThrow(/drifted/i);
    expect((await service.status(intent.changeId)).status).toBe('verification_required');
  });

  it('idempotently reuses or supersedes a pending approval before any human decision', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-reprepare-');
    cleanup.push(workspace);
    const store = new FileDeliveryStore(workspace);
    let tick = 0;
    const service = new DeliveryService(
      store,
      new FakeGit(),
      new FakeMergeRequests(),
      satisfiedEvidence,
      () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000),
    );
    const first = await service.prepare({
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    const replayed = await service.prepare({
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    expect(replayed).toEqual(first);
    expect(await store.history(intent.changeId)).toHaveLength(1);

    const replacement = await service.prepare({
      project,
      intent,
      policy,
      reportContents: 'verified with corrected approval wording',
      evidenceBundleIds: ['bundle-replacement'],
    });
    expect(replacement).toMatchObject({
      status: 'awaiting_approval',
      stateVersion: first.stateVersion + 1,
      approval: null,
    });
    expect(
      replacement.actionResults.every(
        (result) => result.status === 'pending' && result.attempts === 0,
      ),
    ).toBe(true);
    expect(replacement.decisionRequest?.requestId).not.toBe(first.decisionRequest?.requestId);
    expect(replacement.snapshot?.digest).not.toBe(first.snapshot?.digest);
    const history = await store.history(intent.changeId);
    expect(history.map((entry) => entry.type)).toEqual([
      'delivery.prepared',
      'delivery.prepared',
    ]);
    expect(history[1]?.data.supersededRequestId).toBe(first.decisionRequest?.requestId);
    expect(history[1]?.data.previousSnapshotDigest).toBe(first.snapshot?.digest);
    await expect(
      service.decide(
        intent.changeId,
        {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: first.decisionRequest!.requestId,
          snapshotDigest: first.snapshot!.digest,
          decision: 'approve',
        },
        { subject: 'human', provider: 'test-ui', sessionId: 'session-1' },
      ),
    ).rejects.toThrow(/pending snapshot/i);
  });

  it('invalidates approval when a selected worktree becomes dirty', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-dirty-');
    cleanup.push(workspace);
    const git = new FakeGit();
    const originalInspect = git.inspect.bind(git);
    let dirty = false;
    git.inspect = () => originalInspect().then((facts) => ({ ...facts, clean: !dirty }));
    const service = new DeliveryService(
      new FileDeliveryStore(workspace),
      git,
      new FakeMergeRequests(),
      satisfiedEvidence,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    const waiting = await service.prepare({
      project,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    await service.decide(
      intent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'human', provider: 'test-ui', sessionId: 'session-1' },
    );
    dirty = true;
    await expect(
      service.publish({ project, intent, policy, reportContents: 'verified', evidenceBundleIds }),
    ).rejects.toThrow(/clean/i);
    expect(await service.status(intent.changeId)).toMatchObject({
      status: 'verification_required',
      approval: null,
    });
  });

  it('fails publication when the platform returns the coordination MR as a business MR', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-role-collision-');
    cleanup.push(workspace);
    const mergeRequests = new FakeMergeRequests();
    mergeRequests.failOnce = false;
    mergeRequests.identity = {
      provider: 'github',
      repositoryId: 'repo-a',
      number: 99,
      url: 'https://github.com/team/app/pull/99',
    };
    const roleSeparatedIntent: DeliveryIntent = {
      ...intent,
      changeId: 'role-separated-change',
      coordinationMergeRequest: {
        repositoryId: 'repo-a',
        remoteIdentity: 'github.com/team/app',
        sourceBranch: 'spec/role-separated-change',
        targetBranch: 'main',
        mergeRequest: { ...mergeRequests.identity },
      },
    };
    const service = new DeliveryService(
      new FileDeliveryStore(workspace),
      new FakeGit(),
      mergeRequests,
      satisfiedEvidence,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    const waiting = await service.prepare({
      project,
      intent: roleSeparatedIntent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    await service.decide(
      roleSeparatedIntent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'human', provider: 'test-ui', sessionId: 'session-1' },
    );

    await expect(
      service.publish({
        project,
        intent: roleSeparatedIntent,
        policy,
        reportContents: 'verified',
        evidenceBundleIds,
      }),
    ).rejects.toThrow(/same merge request/i);
    expect(await service.status(roleSeparatedIntent.changeId)).toMatchObject({
      status: 'partially_published',
      mergeRequests: {
        coordination: { mergeRequest: { number: 99 } },
        business: [{ mergeRequest: null }],
      },
    });
  });

  it('publishes multiple repositories in stable order', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-multi-');
    cleanup.push(workspace);
    const orderedRepositories: RepositorySnapshot[] = ['repo-b', 'repo-a'].map((id) => ({
      id,
      name: id,
      path: `/unused/${id}`,
      remoteIdentity: `github.com/team/${id}`,
      branch: 'feat/change',
      head: `head-${id}`,
      worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
    }));
    const multiProject = createProjectSnapshot({
      schemaVersion: 1,
      projectId: 'multi',
      root: '/project',
      capturedAt: '2026-01-01T00:00:00.000Z',
      repositories: orderedRepositories,
      diagnostics: [],
    });
    const multiIntent: DeliveryIntent = {
      schemaVersion: 2,
      changeId: 'multi-repo-change',
      coordinationMergeRequest: {
        repositoryId: 'coordination-repository',
        remoteIdentity: 'github.com/team/coordination-repository',
        sourceBranch: 'feat/multi-repo-change',
        targetBranch: 'main',
        mergeRequest: {
          provider: 'github',
          repositoryId: 'coordination-repository',
          number: 100,
          url: 'https://github.com/team/coordination-repository/pull/100',
        },
      },
      repositories: orderedRepositories.map((item) => ({
        repositoryId: item.id,
        sourceBranch: 'feat/change',
        targetBranch: 'main',
        commitMessage: 'feat: change',
        actions: ['merge_request', 'push'],
      })),
    };
    const calls: string[] = [];
    const git: DeliveryGitPort = {
      checkpoint: (item) =>
        Promise.resolve({
          repositoryId: item.id,
          created: false,
          head: item.head,
          checks: [],
          publication: {
            remote: 'origin',
            branch: 'feat/change',
            remoteOid: item.head,
            upstream: 'origin/feat/change',
          },
        }),
      inspect: (item) =>
        Promise.resolve({
          repositoryId: item.id,
          repositoryName: item.name,
          remoteIdentity: item.remoteIdentity,
          sourceBranch: 'feat/change',
          targetBranch: 'main',
          head: item.head,
          tree: `tree-${item.id}`,
          remoteSourceOid: null,
          remoteTargetOid: 'main-head',
          clean: true,
        }),
      push: (item) => {
        calls.push(`push:${item.id}`);
        return Promise.resolve(item.head);
      },
    };
    const mergeRequests: MergeRequestPort = {
      capability: () =>
        Promise.resolve({
          name: 'branch-protection',
          status: 'available',
          blocking: false,
          diagnosticCode: 'available',
        }),
      find: () => Promise.resolve(null),
      create: (input) => {
        calls.push(`mr:${input.repositoryId}`);
        return Promise.resolve({
          provider: 'github',
          repositoryId: input.repositoryId,
          number: calls.length,
          url: `https://github.com/team/${input.repositoryId}/pull/1`,
        });
      },
      update: (identity) => Promise.resolve(identity),
      status: (identity) =>
        Promise.resolve({
          ...identity,
          state: 'open',
          ci: 'pending',
          review: 'pending',
          conversationsResolved: null,
          mergeCommit: null,
          mergedAt: null,
        }),
    };
    const service = new DeliveryService(
      new FileDeliveryStore(workspace),
      git,
      mergeRequests,
      satisfiedEvidence,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    const waiting = await service.prepare({
      project: multiProject,
      intent: multiIntent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    await service.decide(
      multiIntent.changeId,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: waiting.decisionRequest!.requestId,
        snapshotDigest: waiting.snapshot!.digest,
        decision: 'approve',
      },
      { subject: 'human', provider: 'test-ui', sessionId: 'session' },
    );
    await service.publish({
      project: multiProject,
      intent: multiIntent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
    });
    expect(calls).toEqual(['push:repo-a', 'mr:repo-a', 'push:repo-b', 'mr:repo-b']);
  });
});

describe('delivery store crash recovery', () => {
  it('replays a journal once after interruption', async () => {
    const workspace = await temporaryDirectory('repoctopus-delivery-store-');
    cleanup.push(workspace);
    const git = new FakeGit();
    const merge = new FakeMergeRequests();
    const crashing = new DeliveryService(
      new FileDeliveryStore(workspace, {
        afterHistoryWritten: () => {
          throw new Error('crash');
        },
      }),
      git,
      merge,
      satisfiedEvidence,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    await expect(
      crashing.prepare({ project, intent, policy, reportContents: 'verified', evidenceBundleIds }),
    ).rejects.toThrow('crash');
    const recovered = new FileDeliveryStore(workspace);
    expect((await recovered.load(intent.changeId))?.status).toBe('awaiting_approval');
    expect(await recovered.history(intent.changeId)).toHaveLength(1);
  });
});
