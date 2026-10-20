import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { PostMergeReady } from '../domains/post-merge/run.js';
import { postMergeRunOptions } from '../domains/post-merge/run.js';
import {
  createPostMergePublicationReceipt,
  type PostMergePublicationPolicy,
  type PostMergePublicationRequest,
} from '../domains/delivery/post-merge.js';
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

const publicationPolicy: PostMergePublicationPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'PostMergePublicationPolicy',
  operations: ['commit', 'push', 'merge_request.update'],
  remote: 'origin',
  commit: {
    message: 'chore(spec): close verified change',
    authorName: 'Repoctopus',
    authorEmail: 'repoctopus@example.invalid',
  },
  mergeRequest: { title: 'Specification closure', body: 'Verified and closed.' },
};

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

async function writeSpecificationFixture(workspace: string, changeId: string): Promise<void> {
  const files = new Map([
    [
      'openspec/specs/post-merge-automation/spec.md',
      `# Post-merge automation

## Purpose
Exercise guarded post-merge closure.

## Requirements

### Requirement: Existing closure
The system MUST preserve an existing closure.

#### Scenario: Existing closure runs
- **WHEN** the closure runs
- **THEN** it succeeds
`,
    ],
    [
      `openspec/changes/${changeId}/proposal.md`,
      `# Change: ${changeId}

## Why
The fixture needs guarded closure.

## What Changes
- Add guarded closure.

## Capabilities
- \`post-merge-automation\`: extend post-merge closure.

## Impact
- Test fixture only.
`,
    ],
    [
      `openspec/changes/${changeId}/design.md`,
      `# Design

## Context
The fixture closes one change.

## Goals / Non-Goals

**Goals:**
- Exercise the real Provider.

**Non-Goals:**
- Publish a branch.

## Decisions
Use the guarded post-merge path.
`,
    ],
    [`openspec/changes/${changeId}/tasks.md`, '# Tasks\n\n- [x] 1.1 Complete fixture.\n'],
    [
      `openspec/changes/${changeId}/specs/post-merge-automation/spec.md`,
      `# Spec Delta

## ADDED Requirements

### Requirement: Guarded closure
The system MUST audit closure paths.

#### Scenario: Closure is audited
- **WHEN** the change is archived
- **THEN** only planned paths are present
`,
    ],
  ]);
  for (const [relative, contents] of files) {
    const target = path.join(workspace, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

async function harness(mode: 'pass' | 'fail' | 'drift') {
  const root = await temporaryDirectory('repoctopus-post-merge-actions-');
  cleanup.push(root);
  const [appRepository, apiRepository] = await Promise.all([
    createRemoteRepository(root, 'app'),
    createRemoteRepository(root, 'api'),
  ]);
  const workspace = await createGitRepository(root, 'workspace');
  const changeId = `post-merge-${mode}`;
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
  await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
  await writeSpecificationFixture(workspace, changeId);
  await execute('git', ['add', '.'], { cwd: workspace });
  await execute('git', ['commit', '-m', 'configure post-merge fixture'], { cwd: workspace });
  const productRoot = path.resolve(import.meta.dirname, '..');
  const workflowPath = path.join(productRoot, 'workflows', 'post-merge.yaml');
  const workflow = parseWorkflowPackage(await readFile(workflowPath, 'utf8'));
  const app = await bootProjectComposition(productRoot, workspace);
  const publicationRequests: PostMergePublicationRequest[] = [];
  app.context.delivery.publishPostMerge = (request: PostMergePublicationRequest) => {
    publicationRequests.push(structuredClone(request));
    return Promise.resolve(
      createPostMergePublicationReceipt({
        request,
        git: {
          commitOid: 'a'.repeat(40),
          remoteOid: 'a'.repeat(40),
          commitRecovered: false,
          pushRecovered: false,
        },
        mergeRequest: {
          provider: 'github',
          repositoryId: 'coordination',
          number: 8,
          url: 'https://github.example/coordination/pull/8',
        },
        mergeRequestRecovered: false,
      }),
    );
  };
  const repositories = [appRepository, apiRepository];
  const coordination: PostMergeReady = {
    status: 'ready',
    diagnostic: 'post-merge-ready',
    changeId,
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
  const actions = new PostMergeActions(app.context, {
    temporaryRoot,
    workspaceRoot: workspace,
    publicationPolicy,
  });
  return {
    app,
    actions,
    workspace,
    options,
    coordination,
    temporaryRoot,
    repositories,
    sources: repositories.map((repository) => ({
      repositoryId: repository.id,
      path: repository.source,
    })),
    publicationRequests,
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

  it('closes the bound Specification and advances only after the Git diff passes Guardrails', async () => {
    const fixture = await harness('pass');
    try {
      await fixture.actions.verifyMergedCode({
        runId: fixture.options.runId,
        profileId: 'post-merge',
        sources: fixture.sources,
      });
      const closed = await fixture.actions.closeSpecification(fixture.options.runId);
      expect(closed.plan.targetBaselineDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(closed.result.archiveId).toMatch(/^\d{4}-\d{2}-\d{2}-post-merge-pass$/u);
      expect(
        (await fixture.app.context.workflowRuns.status(fixture.options.runId)).state.currentStep,
      ).toBe('audit-paths');

      const audited = await fixture.actions.auditSpecificationClosure(fixture.options.runId);
      expect(audited.audit.changedFiles).toEqual(closed.result.changedFiles);
      expect(
        (await fixture.app.context.workflowRuns.status(fixture.options.runId)).state.currentStep,
      ).toBe('publish');
    } finally {
      await fixture.app.close();
    }
  }, 30_000);

  it('persists publication intent and receipt before completing the Run', async () => {
    const fixture = await harness('pass');
    try {
      await fixture.actions.verifyMergedCode({
        runId: fixture.options.runId,
        profileId: 'post-merge',
        sources: fixture.sources,
      });
      await fixture.actions.closeSpecification(fixture.options.runId);
      const audit = await fixture.actions.auditSpecificationClosure(fixture.options.runId);
      const published = await fixture.actions.publishCoordination(fixture.options.runId);
      const replay = await fixture.actions.publishCoordination(fixture.options.runId);

      expect(fixture.publicationRequests).toHaveLength(1);
      expect(fixture.publicationRequests[0]?.audit.digest).toBe(audit.audit.digest);
      expect(replay.receipt).toEqual(published.receipt);
      expect(
        (await fixture.app.context.workflowRuns.status(fixture.options.runId)).state.status,
      ).toBe('completed');
    } finally {
      await fixture.app.close();
    }
  }, 30_000);

  it('keeps the Run before publish when business source appears in the coordination diff', async () => {
    const fixture = await harness('pass');
    try {
      await fixture.actions.verifyMergedCode({
        runId: fixture.options.runId,
        profileId: 'post-merge',
        sources: fixture.sources,
      });
      await fixture.actions.closeSpecification(fixture.options.runId);
      const source = path.join(fixture.workspace, 'services', 'runtime.ts');
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, 'export const unsafe = true;\n');

      await expect(
        fixture.actions.auditSpecificationClosure(fixture.options.runId),
      ).rejects.toThrow('unapproved path: services/runtime.ts');
      expect(
        (await fixture.app.context.workflowRuns.status(fixture.options.runId)).state.currentStep,
      ).toBe('audit-paths');
    } finally {
      await fixture.app.close();
    }
  }, 30_000);

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
