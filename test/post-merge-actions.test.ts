import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { PostMergeReady } from '../domains/post-merge/run.js';
import { postMergeRunOptions } from '../domains/post-merge/run.js';
import { parseWorkflowPackage } from '../domains/workflow-contract/package.js';
import { normalizeRemoteIdentity } from '../platform/git/remote-identity.js';
import { GitPostMergeCheckout } from '../platform/git/post-merge-checkout.js';
import { execute } from '../platform/process/execute.js';
import { PostMergeActions } from '../services/post-merge-actions.js';
import {
  createGitRepository,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function createRemoteRepository(root: string, id: string) {
  const remote = path.join(root, 'remotes', `${id}.git`);
  await mkdir(path.dirname(remote), { recursive: true });
  await execute('git', ['init', '--bare', '--initial-branch=main', remote], { cwd: root });
  const source = await createGitRepository(root, `${id}-source`, remote);
  await writeFile(path.join(source, 'VERSION.txt'), 'merged\n');
  await execute('git', ['add', 'VERSION.txt'], { cwd: source });
  await execute('git', ['commit', '-m', 'merge candidate'], { cwd: source });
  await execute('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: source });
  const mergeCommit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  await writeFile(path.join(source, 'VERSION.txt'), 'target advanced\n');
  await execute('git', ['add', 'VERSION.txt'], { cwd: source });
  await execute('git', ['commit', '-m', 'advance target'], { cwd: source });
  await execute('git', ['push', 'origin', 'main'], { cwd: source });
  const targetHead = (await execute('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  return {
    id,
    source,
    remote,
    remoteIdentity: normalizeRemoteIdentity(remote),
    mergeCommit,
    targetHead,
  };
}

function profileNode(id: string, repository: string, script: string, dependsOn: string[] = []) {
  return {
    id,
    type: 'command',
    repository,
    dependsOn,
    required: true,
    executable: process.execPath,
    args: ['-e', script],
    timeoutMs: 10_000,
    cache: false,
  };
}

async function harness(mode: 'pass' | 'fail' | 'drift') {
  const root = await temporaryDirectory('repoctopus-post-merge-actions-');
  cleanup.push(root);
  const [appRepository, apiRepository] = await Promise.all([
    createRemoteRepository(root, 'app'),
    createRemoteRepository(root, 'api'),
  ]);
  const workspace = await createGitRepository(root, 'workspace');
  const script =
    mode === 'fail'
      ? 'process.exit(7)'
      : mode === 'drift'
        ? "require('node:fs').writeFileSync('drift.txt', 'changed')"
        : "if (require('node:fs').readFileSync('VERSION.txt', 'utf8').trim() !== 'merged') process.exit(9)";
  await writeFile(
    path.join(workspace, 'repoctopus.yaml'),
    JSON.stringify({
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusProject',
      project: { id: 'post-merge-verification' },
      repositories: [
        { id: 'app', path: '../app-source' },
        { id: 'api', path: '../api-source' },
      ],
      profiles: [
        {
          id: 'post-merge',
          nodes: [
            profileNode('app-check', 'app', script),
            profileNode(
              'api-check',
              'api',
              "if (require('node:fs').readFileSync('VERSION.txt', 'utf8').trim() !== 'merged') process.exit(9)",
            ),
          ],
        },
      ],
    }),
  );
  const productRoot = path.resolve(import.meta.dirname, '..');
  const workflowPath = path.join(productRoot, 'workflows', 'post-merge.yaml');
  const workflow = parseWorkflowPackage(await readFile(workflowPath, 'utf8'));
  const app = await bootProjectComposition(productRoot, workspace);
  const repositories = [appRepository, apiRepository];
  const coordination: PostMergeReady = {
    status: 'ready',
    diagnostic: 'post-merge-ready',
    changeId: `post-merge-${mode}`,
    mergeFactsDigest: `sha256:${(mode === 'pass' ? 'a' : mode === 'fail' ? 'b' : 'c').repeat(64)}`,
    mergeEvidence: repositories.map((repository, index) => ({
      repositoryId: repository.id,
      mergeRequest: {
        provider: 'github',
        repositoryId: repository.id,
        number: 50 + index,
        url: `https://github.example/${repository.id}/pull/${50 + index}`,
      },
      mergeCommit: repository.mergeCommit,
      mergedAt: '2026-10-21T02:00:00.000Z',
      observedAt: '2026-10-21T02:00:01.000Z',
    })),
    repositories: repositories.map((repository) => ({
      repositoryId: repository.id,
      remoteIdentity: repository.remoteIdentity,
      targetBranch: 'main',
      mergeCommit: repository.mergeCommit,
    })),
  };
  const options = postMergeRunOptions({
    coordination,
    workflow,
    projectSnapshot: projectFixture({ root }),
    workflowSource: workflowPath,
  });
  await app.context.workflowRuns.startOrResume(options);
  const temporaryRoot = path.join(root, 'post-merge-checkouts');
  const actions = new PostMergeActions(app.context, { temporaryRoot });
  return {
    app,
    actions,
    options,
    coordination,
    temporaryRoot,
    repositories,
    sources: repositories.map((repository) => ({
      repositoryId: repository.id,
      path: repository.source,
    })),
  };
}

describe('post-merge exact checkout and Evidence', () => {
  it('verifies multiple repositories at recorded merge commits after targets advance', async () => {
    const fixture = await harness('pass');
    try {
      const result = await fixture.actions.verifyMergedCode({
        runId: fixture.options.runId,
        profileId: 'post-merge',
        sources: fixture.sources,
      });

      expect(result.status).toBe('succeeded');
      expect(result.gate.status).toBe('satisfied');
      expect(result.checkout.repositories).toHaveLength(2);
      for (const repository of fixture.repositories) {
        expect(repository.targetHead).not.toBe(repository.mergeCommit);
        expect(
          result.checkout.repositories.find((item) => item.repositoryId === repository.id)
            ?.mergeCommit,
        ).toBe(repository.mergeCommit);
      }
      expect(await exists(result.checkout.root)).toBe(false);
      const run = await fixture.app.context.workflowRuns.status(fixture.options.runId);
      expect(run.state.currentStep).toBe('close-specification');
      expect(run.state.acceptedEvidenceBundleIds).toEqual([result.gate.bundleId]);
      const evidence = await fixture.app.context.evidenceCoordinator.status(result.attemptId);
      expect(evidence.bundle?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 'app-check', status: 'passed' }),
          expect.objectContaining({ nodeId: 'api-check', status: 'passed' }),
        ]),
      );
    } finally {
      await fixture.app.close();
    }
  });

  it('keeps the Run at Evidence and cleans checkouts when a required gate fails', async () => {
    const fixture = await harness('fail');
    try {
      const result = await fixture.actions.verifyMergedCode({
        runId: fixture.options.runId,
        profileId: 'post-merge',
        sources: fixture.sources,
      });
      expect(result.status).toBe('failed');
      expect(result.gate.status).toBe('blocked');
      expect(await exists(result.checkout.root)).toBe(false);
      const run = await fixture.app.context.workflowRuns.status(fixture.options.runId);
      expect(run.state.currentStep).toBe('evidence');
      expect(run.state.acceptedEvidenceBundleIds).toEqual([]);
      const trajectory = await fixture.app.context.runStore.loadTrajectory(fixture.options.runId);
      expect(trajectory.at(-1)?.data.evidenceAttemptId).toBe(result.attemptId);
    } finally {
      await fixture.app.close();
    }
  });

  it('marks Evidence superseded when a checkout changes during verification and cleans it', async () => {
    const fixture = await harness('drift');
    try {
      const result = await fixture.actions.verifyMergedCode({
        runId: fixture.options.runId,
        profileId: 'post-merge',
        sources: fixture.sources,
      });
      expect(result.status).toBe('failed');
      expect(result.gate.status).toBe('blocked');
      expect(await exists(result.checkout.root)).toBe(false);
      const evidence = await fixture.app.context.evidenceCoordinator.status(result.attemptId);
      expect(evidence.attempt.status).toBe('superseded');
      expect(evidence.bundle?.checks.find((check) => check.nodeId === 'app-check')).toMatchObject({
        status: 'passed',
        freshness: 'superseded',
      });
      expect(
        (await fixture.app.context.workflowRuns.status(fixture.options.runId)).state.currentStep,
      ).toBe('evidence');
    } finally {
      await fixture.app.close();
    }
  });

  it('refuses to reuse or delete an unowned checkout directory', async () => {
    const fixture = await harness('pass');
    const occupied = path.join(fixture.temporaryRoot, fixture.options.runId);
    const sentinel = path.join(occupied, 'keep.txt');
    await mkdir(occupied, { recursive: true });
    await writeFile(sentinel, 'user-owned');
    try {
      await expect(
        new GitPostMergeCheckout().checkout({
          runId: fixture.options.runId,
          mergeFactsDigest: fixture.coordination.mergeFactsDigest,
          temporaryRoot: fixture.temporaryRoot,
          repositories: fixture.coordination.repositories,
          sources: fixture.sources,
        }),
      ).rejects.toMatchObject({ code: 'checkout-conflict' });
      expect(await exists(sentinel)).toBe(true);
    } finally {
      await fixture.app.close();
    }
  });
});
