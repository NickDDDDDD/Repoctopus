import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  DeliveryEvidencePort,
  DeliveryStorePort,
  MergeRequestInput,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import {
  type PostMergeGitPublicationInput,
  type PostMergeGitPublicationResult,
  type PostMergePublicationPolicy,
  type PostMergePublicationRequest,
} from '../domains/delivery/post-merge.js';
import { DeliveryService } from '../domains/delivery/service.js';
import type {
  DeliveryState,
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
} from '../domains/delivery/types.js';
import type { PostMergeClosureAudit } from '../domains/post-merge/closure.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { GitDeliveryAdapter } from '../platform/git/delivery.js';
import { GitPostMergeWorkspace } from '../platform/git/post-merge-workspace.js';
import { normalizeRemoteIdentity } from '../platform/git/remote-identity.js';
import { execute } from '../platform/process/execute.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

const policy: PostMergePublicationPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'PostMergePublicationPolicy',
  operations: ['commit', 'push', 'merge_request.update'],
  remote: 'origin',
  commit: {
    message: 'chore(spec): close verified change',
    authorName: 'Repoctopus',
    authorEmail: 'repoctopus@example.invalid',
  },
  mergeRequest: {
    title: 'chore(spec): close verified change',
    body: 'Post-merge verification and specification closure are complete.',
  },
};

interface Fixture {
  root: string;
  repository: string;
  remote: string;
  request: PostMergePublicationRequest;
  coordination: NonNullable<DeliveryState['mergeRequests']>['coordination'];
}

async function fixture(): Promise<Fixture> {
  const root = await temporaryDirectory('repoctopus-post-merge-publication-');
  cleanup.push(root);
  const repository = path.join(root, 'work');
  const remote = path.join(root, 'remote.git');
  await mkdir(repository, { recursive: true });
  await git(root, 'init', '--bare', remote);
  await git(repository, 'init', '--initial-branch=feat/change');
  await git(repository, 'config', 'user.name', 'Developer');
  await git(repository, 'config', 'user.email', 'developer@example.invalid');
  await mkdir(path.join(repository, 'openspec', 'specs', 'demo'), { recursive: true });
  await writeFile(path.join(repository, 'openspec', 'specs', 'demo', 'spec.md'), 'old\n');
  await git(repository, 'add', '--all');
  await git(repository, 'commit', '-m', 'feat: initial');
  await git(repository, 'remote', 'add', 'origin', remote);
  await git(repository, 'push', '--set-upstream', 'origin', 'feat/change');

  const workspace = new GitPostMergeWorkspace();
  const baseline = await workspace.cleanBaseline(repository);
  await writeFile(path.join(repository, 'openspec', 'specs', 'demo', 'spec.md'), 'closed\n');
  const diff = await workspace.diff(baseline);
  const contentDigests = Object.fromEntries(
    diff.changes.map((change) => [change.path, change.contentDigest]),
  );
  const auditBase = {
    schemaVersion: 1 as const,
    planDigest: `sha256:${'1'.repeat(64)}` as const,
    closureId: `sha256:${'2'.repeat(64)}` as const,
    baselineDigest: baseline.digest,
    changedFiles: Object.keys(contentDigests).sort(),
    contentDigests,
  };
  const audit: PostMergeClosureAudit = { ...auditBase, digest: sha256(auditBase) };
  const identity: MergeRequestIdentity = {
    provider: 'github',
    repositoryId: 'coordination',
    number: 8,
    url: 'https://github.test/team/coordination/pull/8',
  };
  const coordination = {
    role: 'coordination' as const,
    repositoryId: 'coordination',
    remoteIdentity: normalizeRemoteIdentity(remote),
    sourceBranch: 'feat/change',
    targetBranch: 'main',
    mergeRequest: identity,
  };
  return {
    root,
    repository,
    remote,
    coordination,
    request: {
      schemaVersion: 1,
      runId: 'run-1',
      changeId: 'change-1',
      workspaceRoot: repository,
      baseline,
      audit,
      policy: structuredClone(policy),
    },
  };
}

class MemoryStore implements DeliveryStorePort {
  constructor(private readonly value: DeliveryState) {}
  load(changeId: string) {
    return Promise.resolve(changeId === this.value.changeId ? structuredClone(this.value) : null);
  }
  list() {
    return Promise.resolve([structuredClone(this.value)]);
  }
  commit(): Promise<void> {
    return Promise.reject(new Error('Unexpected Delivery state mutation'));
  }
  history() {
    return Promise.resolve([]);
  }
  approvedEvidenceBundleIds() {
    return Promise.resolve([]);
  }
}

class CoordinationMergeRequests implements MergeRequestPort {
  updateCalls = 0;
  state: MergeRequestStatus['state'] = 'open';
  targetBranch = 'main';
  title = 'development';
  body = 'in progress';
  failUpdateAfterApply = false;

  constructor(
    private readonly identity: MergeRequestIdentity,
    private readonly remote: string,
  ) {}

  capability(): Promise<PlatformCapability> {
    return Promise.reject(new Error('Unexpected capability lookup'));
  }
  find(): Promise<MergeRequestIdentity | null> {
    return Promise.reject(new Error('Post-merge publication must not find another MR'));
  }
  create(): Promise<MergeRequestIdentity> {
    return Promise.reject(new Error('Post-merge publication must not create another MR'));
  }
  update(identity: MergeRequestIdentity, input: MergeRequestInput) {
    expect(identity).toEqual(this.identity);
    expect(input.sourceBranch).toBe('feat/change');
    expect(input.targetBranch).toBe('main');
    this.updateCalls += 1;
    this.title = input.title;
    this.body = input.body;
    if (this.failUpdateAfterApply) {
      this.failUpdateAfterApply = false;
      return Promise.reject(new Error('MR update response lost'));
    }
    return Promise.resolve(structuredClone(this.identity));
  }
  async status(): Promise<MergeRequestStatus> {
    const headCommit = (
      await execute('git', ['ls-remote', '--heads', this.remote, 'refs/heads/feat/change'], {
        cwd: path.dirname(this.remote),
      })
    ).stdout.split(/\s+/u)[0]!;
    return {
      ...this.identity,
      state: this.state,
      sourceBranch: 'feat/change',
      targetBranch: this.targetBranch,
      headCommit,
      title: this.title,
      body: this.body,
      ci: 'passed',
      review: 'approved',
      conversationsResolved: true,
      mergeCommit: null,
      mergedAt: null,
    };
  }
}

const satisfiedEvidence: DeliveryEvidencePort = {
  assertSatisfied: () => Promise.resolve(),
};

function service(
  fx: Fixture,
  mergeRequests: CoordinationMergeRequests,
  gitAdapter = new GitDeliveryAdapter(),
) {
  const state: DeliveryState = {
    schemaVersion: 2,
    changeId: fx.request.changeId,
    stateVersion: 1,
    status: 'merged',
    snapshot: null,
    decisionRequest: null,
    approval: null,
    actionResults: [],
    mergeEvidence: [],
    mergeRequests: { coordination: fx.coordination, business: [] },
    platformCapabilities: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return new DeliveryService(
    new MemoryStore(state),
    gitAdapter,
    mergeRequests,
    satisfiedEvidence,
    undefined,
    undefined,
    undefined,
    gitAdapter,
  );
}

describe('protected post-merge publication', () => {
  it('creates one ordinary commit, pushes it, and updates only the original coordination MR', async () => {
    const fx = await fixture();
    const mergeRequests = new CoordinationMergeRequests(fx.coordination.mergeRequest, fx.remote);
    const receipt = await service(fx, mergeRequests).publishPostMerge(fx.request);
    expect(receipt.commitOid).toBe(await git(fx.repository, 'rev-parse', 'HEAD'));
    expect(receipt.remoteOid).toBe(receipt.commitOid);
    expect(receipt.commitRecovered).toBe(false);
    expect(receipt.pushRecovered).toBe(false);
    expect(receipt.mergeRequestRecovered).toBe(false);
    expect(mergeRequests.updateCalls).toBe(1);
    expect(
      await git(fx.repository, 'rev-list', '--count', fx.request.baseline.head + '..HEAD'),
    ).toBe('1');
    expect(await git(fx.repository, 'status', '--porcelain')).toBe('');
  });

  it('recovers the same commit and push after a lost Git response without duplicating either', async () => {
    const fx = await fixture();
    const mergeRequests = new CoordinationMergeRequests(fx.coordination.mergeRequest, fx.remote);
    class LostResponseGit extends GitDeliveryAdapter {
      override async publishPostMerge(
        input: PostMergeGitPublicationInput,
      ): Promise<PostMergeGitPublicationResult> {
        await super.publishPostMerge(input);
        throw new Error('push response lost');
      }
    }
    await expect(
      service(fx, mergeRequests, new LostResponseGit()).publishPostMerge(fx.request),
    ).rejects.toThrow('push response lost');
    const receipt = await service(fx, mergeRequests).publishPostMerge(fx.request);
    expect(receipt.commitRecovered).toBe(true);
    expect(receipt.pushRecovered).toBe(true);
    expect(
      await git(fx.repository, 'rev-list', '--count', fx.request.baseline.head + '..HEAD'),
    ).toBe('1');
    expect(mergeRequests.updateCalls).toBe(1);
  });

  it('recovers an applied MR update when its response was lost', async () => {
    const fx = await fixture();
    const mergeRequests = new CoordinationMergeRequests(fx.coordination.mergeRequest, fx.remote);
    mergeRequests.failUpdateAfterApply = true;
    await expect(service(fx, mergeRequests).publishPostMerge(fx.request)).rejects.toThrow(
      'MR update response lost',
    );
    const receipt = await service(fx, mergeRequests).publishPostMerge(fx.request);
    expect(receipt.mergeRequestRecovered).toBe(true);
    expect(mergeRequests.updateCalls).toBe(1);
  });

  it('stops before local Git side effects when the MR is closed or the remote source drifted', async () => {
    const closed = await fixture();
    const closedMergeRequests = new CoordinationMergeRequests(
      closed.coordination.mergeRequest,
      closed.remote,
    );
    closedMergeRequests.state = 'closed';
    await expect(
      service(closed, closedMergeRequests).publishPostMerge(closed.request),
    ).rejects.toThrow('is not open');
    expect(await git(closed.repository, 'rev-parse', 'HEAD')).toBe(closed.request.baseline.head);

    const drifted = await fixture();
    const other = path.join(drifted.root, 'other');
    await git(drifted.root, 'clone', drifted.remote, other);
    await git(other, 'checkout', 'feat/change');
    await git(other, 'config', 'user.name', 'Other');
    await git(other, 'config', 'user.email', 'other@example.invalid');
    await writeFile(path.join(other, 'remote-drift.md'), 'drift\n');
    await git(other, 'add', '--all');
    await git(other, 'commit', '-m', 'chore: remote drift');
    await git(other, 'push', 'origin', 'feat/change');
    const driftedMergeRequests = new CoordinationMergeRequests(
      drifted.coordination.mergeRequest,
      drifted.remote,
    );
    await expect(
      service(drifted, driftedMergeRequests).publishPostMerge(drifted.request),
    ).rejects.toThrow('remote source drifted');
    expect(await git(drifted.repository, 'rev-parse', 'HEAD')).toBe(drifted.request.baseline.head);
    expect(driftedMergeRequests.updateCalls).toBe(0);
  });

  it.each(['merge', 'force_push', 'rebase', 'branch.delete'])(
    'rejects the forbidden %s operation before commit',
    async (operation) => {
      const fx = await fixture();
      fx.request.policy.operations = ['commit', 'push', operation];
      const mergeRequests = new CoordinationMergeRequests(fx.coordination.mergeRequest, fx.remote);
      await expect(service(fx, mergeRequests).publishPostMerge(fx.request)).rejects.toThrow(
        'forbidden-or-incomplete-operations',
      );
      expect(await git(fx.repository, 'rev-parse', 'HEAD')).toBe(fx.request.baseline.head);
      expect(mergeRequests.updateCalls).toBe(0);
    },
  );
});
