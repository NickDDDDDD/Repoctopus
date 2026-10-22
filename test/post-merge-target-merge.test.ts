import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChangeBranchReference } from '../domains/specification/types.js';
import { normalizeRemoteIdentity } from '../platform/git/remote-identity.js';
import { GitPostMergeCheckout } from '../platform/git/post-merge-checkout.js';
import { execute } from '../platform/process/execute.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function fixture(options: { conflict?: boolean } = {}) {
  const root = await temporaryDirectory('repoctopus-target-merge-');
  cleanup.push(root);
  const remote = path.join(root, 'workspace.git');
  await mkdir(remote);
  await execute('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
  const source = await createGitRepository(root, 'workspace', remote);
  await execute('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: source });

  await execute('git', ['switch', '-c', 'spec/target-merge'], { cwd: source });
  if (options.conflict) {
    await writeFile(path.join(source, 'README.md'), '# planned change\n');
  } else {
    await writeFile(path.join(source, 'planning.md'), '# Planned change\n');
  }
  await execute('git', ['add', '.'], { cwd: source });
  await execute('git', ['commit', '-m', 'docs: publish change plan'], { cwd: source });
  await execute('git', ['push', '--set-upstream', 'origin', 'spec/target-merge'], {
    cwd: source,
  });
  const sourceOid = await git(source, ['rev-parse', 'HEAD']);

  await execute('git', ['switch', 'main'], { cwd: source });
  if (options.conflict) {
    await writeFile(path.join(source, 'README.md'), '# merged business change\n');
  } else {
    await writeFile(path.join(source, 'business.md'), '# Merged business change\n');
  }
  await execute('git', ['add', '.'], { cwd: source });
  await execute('git', ['commit', '-m', 'feat: merge business change'], { cwd: source });
  await execute('git', ['push', 'origin', 'main'], { cwd: source });
  const targetOid = await git(source, ['rev-parse', 'HEAD']);
  const changeBranch: ChangeBranchReference = {
    repositoryId: 'workspace',
    remoteIdentity: normalizeRemoteIdentity(remote),
    sourceBranch: 'spec/target-merge',
    targetBranch: 'main',
    remoteOid: sourceOid,
  };
  return {
    root,
    remote,
    source,
    sourceOid,
    targetOid,
    changeBranch,
    temporaryRoot: path.join(root, 'checkouts'),
    sourceReference: { repositoryId: 'workspace', path: source },
  };
}

async function prepare(checkout: GitPostMergeCheckout, fx: Awaited<ReturnType<typeof fixture>>) {
  return checkout.prepareTargetMerge({
    runId: 'post-merge-target-run',
    mergeFactsDigest: `sha256:${'a'.repeat(64)}`,
    remote: 'origin',
    changeBranch: fx.changeBranch,
    source: fx.sourceReference,
  });
}

describe('Post-merge Change branch target merge', () => {
  it('creates a clean ordinary merge with the locked Change and target parents', async () => {
    const fx = await fixture();
    const checkout = new GitPostMergeCheckout();
    const intent = await prepare(checkout, fx);
    const receipt = await checkout.mergeTarget({
      temporaryRoot: fx.temporaryRoot,
      source: fx.sourceReference,
      intent,
    });

    expect(intent.targetOid).toBe(fx.targetOid);
    expect(receipt.parents).toEqual([fx.sourceOid, fx.targetOid]);
    expect(receipt.mergeCommitOid).not.toBe(fx.sourceOid);
    expect(receipt.mergeCommitOid).not.toBe(fx.targetOid);
    await expect(checkout.verifyTargetMerge(intent, receipt)).resolves.toBeUndefined();
    expect(await git(receipt.checkoutPath, ['rev-list', '--parents', '-n', '1', 'HEAD'])).toBe(
      [receipt.mergeCommitOid, fx.sourceOid, fx.targetOid].join(' '),
    );
    expect(await git(fx.source, ['ls-remote', '--heads', 'origin', 'spec/target-merge'])).toContain(
      fx.sourceOid,
    );
  });

  it('stops on a content conflict without changing the remote Change branch', async () => {
    const fx = await fixture({ conflict: true });
    const checkout = new GitPostMergeCheckout();
    const intent = await prepare(checkout, fx);

    await expect(
      checkout.mergeTarget({
        temporaryRoot: fx.temporaryRoot,
        source: fx.sourceReference,
        intent,
      }),
    ).rejects.toMatchObject({ code: 'target-merge-conflict' });
    expect(await git(fx.source, ['ls-remote', '--heads', 'origin', 'spec/target-merge'])).toContain(
      fx.sourceOid,
    );
  });

  it('rejects target drift after the merge Intent locks its OID', async () => {
    const fx = await fixture();
    const checkout = new GitPostMergeCheckout();
    const intent = await prepare(checkout, fx);
    await writeFile(path.join(fx.source, 'later.md'), '# Later target change\n');
    await execute('git', ['add', 'later.md'], { cwd: fx.source });
    await execute('git', ['commit', '-m', 'feat: advance target again'], { cwd: fx.source });
    await execute('git', ['push', 'origin', 'main'], { cwd: fx.source });

    await expect(
      checkout.mergeTarget({
        temporaryRoot: fx.temporaryRoot,
        source: fx.sourceReference,
        intent,
      }),
    ).rejects.toMatchObject({ code: 'target-branch-drift' });
  });

  it('recovers the same merge commit after interruption before Receipt persistence', async () => {
    const fx = await fixture();
    let interrupted = false;
    const crashing = new GitPostMergeCheckout({
      afterTargetMergeCreated() {
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated-target-merge-interruption');
        }
      },
    });
    const intent = await prepare(crashing, fx);
    await expect(
      crashing.mergeTarget({
        temporaryRoot: fx.temporaryRoot,
        source: fx.sourceReference,
        intent,
      }),
    ).rejects.toThrow('simulated-target-merge-interruption');

    const recovered = await new GitPostMergeCheckout().mergeTarget({
      temporaryRoot: fx.temporaryRoot,
      source: fx.sourceReference,
      intent,
    });
    const replay = await new GitPostMergeCheckout().mergeTarget({
      temporaryRoot: fx.temporaryRoot,
      source: fx.sourceReference,
      intent,
    });
    expect(replay).toEqual(recovered);
    expect(recovered.parents).toEqual([fx.sourceOid, fx.targetOid]);
  });
});
