import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FinalChangePublicationService } from '../domains/delivery/final-change-publication.js';
import type { FinalMergeRequestPort, MergeRequestInput } from '../domains/delivery/ports.js';
import type {
  PostMergePublicationPolicyV2,
  PostMergePublicationRequestV2,
} from '../domains/delivery/post-merge.js';
import type {
  MergeRequestIdentity,
  MergeRequestStatus,
  PlatformCapability,
} from '../domains/delivery/types.js';
import type { PostMergeClosureAudit } from '../domains/post-merge/closure.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { GitDeliveryAdapter } from '../platform/git/delivery.js';
import { GitPostMergeCheckout } from '../platform/git/post-merge-checkout.js';
import { GitPostMergeWorkspace } from '../platform/git/post-merge-workspace.js';
import { normalizeRemoteIdentity } from '../platform/git/remote-identity.js';
import { execute } from '../platform/process/execute.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

const policy: PostMergePublicationPolicyV2 = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'PostMergePublicationPolicy',
  operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'],
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
  remote: string;
  sourceOid: string;
  request: PostMergePublicationRequestV2;
}

async function fixture(): Promise<Fixture> {
  const root = await temporaryDirectory('repoctopus-final-change-publication-');
  cleanup.push(root);
  const remote = path.join(root, 'workspace.git');
  await mkdir(remote);
  await execute('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
  const source = await createGitRepository(root, 'workspace', remote);
  await execute('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: source });

  await execute('git', ['switch', '-c', 'spec/final-change'], { cwd: source });
  await writeFile(path.join(source, 'planning.md'), '# Planned change\n');
  await execute('git', ['add', '.'], { cwd: source });
  await execute('git', ['commit', '-m', 'docs: publish change plan'], { cwd: source });
  await execute('git', ['push', '--set-upstream', 'origin', 'spec/final-change'], { cwd: source });
  const sourceOid = await git(source, 'rev-parse', 'HEAD');

  await execute('git', ['switch', 'main'], { cwd: source });
  await writeFile(path.join(source, 'business.md'), '# Merged business change\n');
  await execute('git', ['add', '.'], { cwd: source });
  await execute('git', ['commit', '-m', 'feat: merge business change'], { cwd: source });
  await execute('git', ['push', 'origin', 'main'], { cwd: source });

  const checkout = new GitPostMergeCheckout();
  const changeBranch = {
    repositoryId: 'workspace',
    remoteIdentity: normalizeRemoteIdentity(remote),
    sourceBranch: 'spec/final-change',
    targetBranch: 'main',
    remoteOid: sourceOid,
  };
  const targetMergeIntent = await checkout.prepareTargetMerge({
    runId: 'final-change-run',
    mergeFactsDigest: `sha256:${'a'.repeat(64)}`,
    remote: 'origin',
    changeBranch,
    source: { repositoryId: 'workspace', path: source },
  });
  const targetMergeReceipt = await checkout.mergeTarget({
    temporaryRoot: path.join(root, 'checkouts'),
    source: { repositoryId: 'workspace', path: source },
    intent: targetMergeIntent,
  });

  const workspace = new GitPostMergeWorkspace();
  const baseline = await workspace.cleanBaseline(targetMergeReceipt.checkoutPath);
  const closurePath = path.join(
    targetMergeReceipt.checkoutPath,
    'openspec',
    'changes',
    'archive',
    '2026-10-22-final-change',
    'spec.md',
  );
  await mkdir(path.dirname(closurePath), { recursive: true });
  await writeFile(closurePath, '# Closed specification\n');
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
  return {
    root,
    remote,
    sourceOid,
    request: {
      schemaVersion: 2,
      runId: 'final-change-run',
      changeId: 'final-change',
      evidenceBundleId: 'bundle-final-change',
      workspaceRoot: targetMergeReceipt.checkoutPath,
      targetMerge: { intent: targetMergeIntent, receipt: targetMergeReceipt },
      baseline,
      audit,
      policy: structuredClone(policy),
    },
  };
}

class FinalMergeRequests implements FinalMergeRequestPort {
  readonly identities: MergeRequestIdentity[] = [];
  createCalls = 0;
  updateCalls = 0;
  findAllCalls = 0;
  loseNextCreateResponse = false;
  state: MergeRequestStatus['state'] = 'open';
  sourceBranch = 'spec/final-change';
  targetBranch = 'main';
  headCommit: string | null = null;
  title = policy.mergeRequest.title;
  body = policy.mergeRequest.body;

  constructor(private readonly remote: string) {}

  capability(): Promise<PlatformCapability> {
    throw new Error('not used');
  }

  find(): Promise<MergeRequestIdentity | null> {
    throw new Error('Final publication must use the ambiguity-aware lookup');
  }

  findAll(): Promise<MergeRequestIdentity[]> {
    this.findAllCalls += 1;
    return Promise.resolve(structuredClone(this.identities));
  }

  async create(): Promise<MergeRequestIdentity> {
    this.createCalls += 1;
    const remoteHead = await this.remoteHead();
    expect(remoteHead).not.toBeNull();
    const created = this.identity(this.identities.length + 1);
    this.identities.push(created);
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      throw new Error('final MR create response lost');
    }
    return structuredClone(created);
  }

  update(identity: MergeRequestIdentity, input: MergeRequestInput): Promise<MergeRequestIdentity> {
    this.updateCalls += 1;
    this.title = input.title;
    this.body = input.body;
    return Promise.resolve(structuredClone(identity));
  }

  async status(identity: MergeRequestIdentity): Promise<MergeRequestStatus> {
    const headCommit = this.headCommit ?? (await this.remoteHead());
    if (!headCommit) throw new Error('Final Change branch is not published');
    return {
      ...structuredClone(identity),
      state: this.state,
      sourceBranch: this.sourceBranch,
      targetBranch: this.targetBranch,
      headCommit,
      title: this.title,
      body: this.body,
      ci: 'pending',
      review: 'pending',
      conversationsResolved: null,
      mergeCommit: null,
      mergedAt: null,
    };
  }

  identity(number: number): MergeRequestIdentity {
    return {
      provider: 'github',
      repositoryId: 'workspace',
      number,
      url: `https://github.test/team/workspace/pull/${number}`,
    };
  }

  private async remoteHead(): Promise<string | null> {
    const output = await git(
      path.dirname(this.remote),
      'ls-remote',
      '--heads',
      this.remote,
      'refs/heads/spec/final-change',
    );
    return output.split(/\s+/u)[0] || null;
  }
}

function service(mergeRequests: FinalMergeRequests) {
  return new FinalChangePublicationService(new GitDeliveryAdapter(), mergeRequests);
}

describe('final Change publication', () => {
  it('publishes the audited closure branch before creating the final MR', async () => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    const receipt = await service(mergeRequests).publish(fx.request);

    expect(receipt).toMatchObject({
      schemaVersion: 2,
      mergeRequestRecovered: false,
      commitRecovered: false,
      pushRecovered: false,
      mergeRequestHeadOid: receipt.commitOid,
    });
    expect(mergeRequests.createCalls).toBe(1);
    expect(await git(fx.request.workspaceRoot, 'rev-parse', 'HEAD')).toBe(receipt.commitOid);
    expect(
      await git(
        fx.request.workspaceRoot,
        'ls-remote',
        '--heads',
        'origin',
        'refs/heads/spec/final-change',
      ),
    ).toContain(receipt.commitOid);
    expect(await git(fx.request.workspaceRoot, 'rev-parse', 'HEAD^')).toBe(
      fx.request.targetMerge.receipt.mergeCommitOid,
    );
  });

  it('recovers one final MR after its create response is lost', async () => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    mergeRequests.loseNextCreateResponse = true;

    await expect(service(mergeRequests).publish(fx.request)).rejects.toThrow(
      'create response lost',
    );
    const receipt = await service(mergeRequests).publish(fx.request);

    expect(receipt.mergeRequestRecovered).toBe(true);
    expect(receipt.commitRecovered).toBe(true);
    expect(receipt.pushRecovered).toBe(true);
    expect(mergeRequests.createCalls).toBe(1);
    expect(mergeRequests.identities).toHaveLength(1);
  });

  it('reuses the unique matching MR and repairs metadata without replacing it', async () => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    mergeRequests.identities.push(mergeRequests.identity(9));
    mergeRequests.title = 'stale title';

    const receipt = await service(mergeRequests).publish(fx.request);

    expect(receipt.mergeRequest).toEqual(mergeRequests.identity(9));
    expect(receipt.mergeRequestRecovered).toBe(true);
    expect(mergeRequests.createCalls).toBe(0);
    expect(mergeRequests.updateCalls).toBe(1);
  });

  it('fails closed when more than one MR has the same repository/head/base tuple', async () => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    mergeRequests.identities.push(mergeRequests.identity(1), mergeRequests.identity(2));

    await expect(service(mergeRequests).publish(fx.request)).rejects.toThrow(
      'Multiple final Change MRs',
    );
    expect(mergeRequests.createCalls).toBe(0);
  });

  it('does not replace an equivalent final MR that was already closed', async () => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    mergeRequests.identities.push(mergeRequests.identity(4));
    mergeRequests.state = 'closed';

    await expect(service(mergeRequests).publish(fx.request)).rejects.toThrow('is not open: closed');
    expect(mergeRequests.createCalls).toBe(0);
  });

  it.each([
    ['sourceBranch', 'spec/another-change'],
    ['targetBranch', 'release'],
    ['headCommit', 'f'.repeat(40)],
  ] as const)('rejects recovered final MR %s drift', async (field, value) => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    mergeRequests.identities.push(mergeRequests.identity(3));
    mergeRequests[field] = value;

    await expect(service(mergeRequests).publish(fx.request)).rejects.toThrow(
      field === 'headCommit' ? 'head commit drifted' : 'head/base mapping drifted',
    );
    expect(mergeRequests.createCalls).toBe(0);
  });

  it('rejects unaudited paths before push or any final MR lookup', async () => {
    const fx = await fixture();
    const mergeRequests = new FinalMergeRequests(fx.remote);
    await writeFile(path.join(fx.request.workspaceRoot, 'business.md'), '# Unauthorized edit\n');

    await expect(service(mergeRequests).publish(fx.request)).rejects.toThrow(
      'workspace changed after audited paths were staged',
    );
    expect(mergeRequests.findAllCalls).toBe(0);
    expect(mergeRequests.createCalls).toBe(0);
    expect(
      await git(fx.request.workspaceRoot, 'ls-remote', '--heads', 'origin', 'spec/final-change'),
    ).toContain(fx.sourceOid);
  });

  it.each(['merge', 'force_push', 'rebase', 'branch.delete'])(
    'rejects forbidden %s policy authority before Git or MR side effects',
    async (operation) => {
      const fx = await fixture();
      const mergeRequests = new FinalMergeRequests(fx.remote);
      fx.request.policy.operations = ['merge_target', 'commit', 'push', operation];

      await expect(service(mergeRequests).publish(fx.request)).rejects.toThrow(
        'forbidden-or-incomplete-operations',
      );
      expect(mergeRequests.findAllCalls).toBe(0);
      expect(await git(fx.request.workspaceRoot, 'rev-parse', 'HEAD')).toBe(
        fx.request.targetMerge.receipt.mergeCommitOid,
      );
    },
  );
});
