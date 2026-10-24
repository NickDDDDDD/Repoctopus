import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { afterEach, expect, it } from 'vitest';

import { normalizeRemoteIdentity } from '../../platform/git/remote-identity.js';
import { createOpenSpecStoreEnvironment } from '../helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const productRoot = path.resolve(import.meta.dirname, '..', '..');
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd })).stdout.trim();
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port fixture did not bind');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function repository(root: string, name: string) {
  const remote = path.join(root, 'remotes', `${name}.git`);
  const source = path.join(root, name);
  await mkdir(path.dirname(remote), { recursive: true });
  await git(root, 'init', '--bare', '--initial-branch=main', remote);
  await git(root, 'clone', pathToFileURL(remote).href, source);
  await git(source, 'config', 'user.name', 'Repoctopus E2E');
  await git(source, 'config', 'user.email', 'repoctopus-e2e@example.invalid');
  await writeFile(path.join(source, 'README.md'), `# ${name}\n`);
  await git(source, 'add', '.');
  await git(source, 'commit', '-m', `feat: initialize ${name}`);
  await git(source, 'push', '--set-upstream', 'origin', 'main');
  return {
    source,
    remote,
    remoteIdentity: normalizeRemoteIdentity(pathToFileURL(remote).href),
    head: await git(source, 'rev-parse', 'HEAD'),
  };
}

async function writeSpecification(workspace: string, changeId: string): Promise<void> {
  const files = new Map([
    [
      'openspec/specs/post-merge-automation/spec.md',
      `# Post-merge automation

## Purpose
Exercise final Change publication.

## Requirements

### Requirement: Existing behavior
The system MUST preserve existing behavior.

#### Scenario: Existing behavior runs
- **WHEN** the workflow runs
- **THEN** it succeeds
`,
    ],
    [
      `openspec/changes/${changeId}/proposal.md`,
      `# Change: ${changeId}

## Why
Exercise final Change publication.

## What Changes
- Add final Change publication coverage.

## Capabilities
- \`post-merge-automation\`: extend final publication.

## Impact
- E2E fixture only.
`,
    ],
    [
      `openspec/changes/${changeId}/design.md`,
      `# Design

## Context
The fixture closes one Change.

## Goals / Non-Goals

**Goals:**
- Exercise target merge and final publication.

**Non-Goals:**
- Merge the final MR.

## Decisions
Use the locked target OID and ordinary push.
`,
    ],
    [`openspec/changes/${changeId}/tasks.md`, '# Tasks\n\n- [x] 1.1 Complete E2E.\n'],
    [
      `openspec/changes/${changeId}/specs/post-merge-automation/spec.md`,
      `# Spec Delta

## ADDED Requirements

### Requirement: Final Change publication
The system MUST create the final MR only after closure publication.

#### Scenario: Closure completes
- **WHEN** Evidence and closure succeed
- **THEN** the final MR references the published closure commit
`,
    ],
  ]);
  for (const [relative, contents] of files) {
    const target = path.join(workspace, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

it('fences the legacy out-of-process Post-merge writer behind the Change lifecycle', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-final-change-e2e-'));
  const buildRoot = await mkdtemp(
    path.join(productRoot, 'node_modules', '.repoctopus-final-change-build-'),
  );
  roots.push(root, buildRoot);
  const workspace = await repository(root, 'workspace');
  const business = await repository(root, 'business');
  const changeId = 'final-change-e2e';
  const sourceBranch = 'spec/final-change-e2e';

  await git(workspace.source, 'switch', '-c', sourceBranch);
  await writeFile(path.join(workspace.source, '.gitignore'), '.repoctopus/\n');
  await writeSpecification(workspace.source, changeId);
  const storeEnvironment = await createOpenSpecStoreEnvironment(
    root,
    workspace.source,
    'final-change-e2e',
  );
  const port = await availablePort();
  await writeFile(
    path.join(workspace.source, 'repoctopus.yaml'),
    `${JSON.stringify(
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'final-change-e2e', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: 'business', path: '../business' },
        ],
        profiles: [
          {
            id: 'post-merge',
            nodes: [
              {
                id: 'business-check',
                type: 'command',
                repository: 'business',
                executable: process.execPath,
                args: ['-e', "require('node:fs').accessSync('README.md')"],
              },
            ],
          },
        ],
        delivery: {
          checkpoint: {
            automatic: true,
            protectedBranches: ['main'],
            commitMessagePattern: '^.+',
            quickChecks: { '*': [] },
          },
          publication: {
            remote: 'origin',
            provider: 'github',
            githubApiBaseUrl: 'https://mock.invalid',
            mrTitleTemplate: '{{changeId}}',
            mrBodyTemplate: '{{verificationReport}}',
          },
        },
        skillProviders: [{ id: 'skill-provider-matt' }],
        specificationProvider: {
          id: 'specification-openspec',
          store: { id: 'final-change-e2e', repositoryId: 'workspace' },
        },
        platformEvents: {
          storeProvider: { id: 'platform-events-file' },
          http: { hostname: '127.0.0.1', port, shutdownTimeoutMs: 1000 },
          github: {
            source: 'e2e',
            path: '/webhooks/github',
            maxBodyBytes: 65536,
            webhookCredential: {
              provider: 'environment',
              variable: 'REPOCTOPUS_E2E_WEBHOOK_SECRET',
            },
            apiCredential: {
              provider: 'environment',
              variable: 'REPOCTOPUS_E2E_GITHUB_TOKEN',
            },
          },
          runner: {
            identity: 'e2e-runner',
            leaseMs: 500,
            pollIntervalMs: 200,
            retryDelayMs: 100,
            maxAttempts: 3,
            shutdownTimeoutMs: 1000,
          },
        },
        postMerge: {
          runnerIdentity: 'e2e-runner',
          temporaryRoot: '.repoctopus/post-merge-checkouts',
          evidenceProfile: 'post-merge',
          allowedWorkspacePaths: {
            specificationClosure: true,
            verificationPathPrefixes: [],
          },
          publication: {
            operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'],
            remote: 'origin',
            commit: {
              message: 'chore(spec): close verified change',
              authorNameCredential: {
                provider: 'environment',
                variable: 'REPOCTOPUS_E2E_AUTHOR_NAME',
              },
              authorEmailCredential: {
                provider: 'environment',
                variable: 'REPOCTOPUS_E2E_AUTHOR_EMAIL',
              },
            },
            finalChangeMergeRequest: {
              title: 'legacy bootstrap policy',
              body: 'replaced by the v2 action fixture',
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await git(workspace.source, 'add', '.');
  await git(workspace.source, 'commit', '-m', 'docs: publish final Change plan');
  await git(workspace.source, 'push', '--set-upstream', 'origin', sourceBranch);
  const sourceOid = await git(workspace.source, 'rev-parse', 'HEAD');

  const targetWriter = path.join(root, 'workspace-target');
  await git(root, 'clone', pathToFileURL(workspace.remote).href, targetWriter);
  await git(targetWriter, 'config', 'user.name', 'Business Integrator');
  await git(targetWriter, 'config', 'user.email', 'integrator@example.invalid');
  await writeFile(path.join(targetWriter, 'target-advanced.md'), '# Target advanced\n');
  await git(targetWriter, 'add', '.');
  await git(targetWriter, 'commit', '-m', 'feat: advance workspace target');
  await git(targetWriter, 'push', 'origin', 'main');

  const mergeRequestStateFile = path.join(root, 'final-merge-requests.json');
  await writeFile(
    mergeRequestStateFile,
    `${JSON.stringify({ created: 0, updated: 0, mergeRequests: [] }, null, 2)}\n`,
  );
  const inputFile = path.join(root, 'input.json');
  await writeFile(
    inputFile,
    `${JSON.stringify(
      {
        productRoot,
        workspaceRoot: workspace.source,
        temporaryRoot: path.join(root, 'post-merge-checkouts'),
        workflowSource: path.join(productRoot, 'workflows', 'post-merge.yaml'),
        evidenceProfile: 'post-merge',
        coordination: {
          status: 'ready',
          diagnostic: 'post-merge-ready',
          changeId,
          mergeFactsDigest: `sha256:${'a'.repeat(64)}`,
          changeBranch: {
            repositoryId: 'workspace',
            remoteIdentity: workspace.remoteIdentity,
            sourceBranch,
            targetBranch: 'main',
            remoteOid: sourceOid,
          },
          mergeEvidence: [
            {
              deliveryId: 'primary',
              repositoryId: 'business',
              mergeRequest: {
                provider: 'github',
                repositoryId: 'business',
                number: 11,
                url: 'https://mock.invalid/business/pull/11',
              },
              mergeCommit: business.head,
              mergedAt: '2026-10-22T00:00:00.000Z',
              observedAt: '2026-10-22T00:00:01.000Z',
            },
          ],
          repositories: [
            {
              repositoryId: 'business',
              remoteIdentity: business.remoteIdentity,
              targetBranch: 'main',
              mergeCommit: business.head,
            },
          ],
        },
        sources: [{ repositoryId: 'business', path: business.source }],
        mergeRequestStateFile,
        workspaceRemote: workspace.remote,
      },
      null,
      2,
    )}\n`,
  );

  const executable = path.join(buildRoot, 'final-change-post-merge-process.mjs');
  await build({
    entryPoints: [path.join(productRoot, 'test', 'fixtures', 'final-change-post-merge-process.ts')],
    outfile: executable,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'silent',
  });
  const environment: NodeJS.ProcessEnv = {
    ...storeEnvironment,
    REPOCTOPUS_E2E_WEBHOOK_SECRET: 'secret',
    REPOCTOPUS_E2E_GITHUB_TOKEN: 'token',
    REPOCTOPUS_E2E_AUTHOR_NAME: 'Repoctopus E2E',
    REPOCTOPUS_E2E_AUTHOR_EMAIL: 'repoctopus-e2e@example.invalid',
  };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('OTEL_EXPORTER_OTLP')) delete environment[key];
  }
  const interrupted = await execFileAsync(
    process.execPath,
    [executable, inputFile, 'interrupt-before-publish'],
    {
      cwd: productRoot,
      env: environment,
      timeout: 45_000,
    },
  );
  expect(JSON.parse(interrupted.stdout.trim().split(/\r?\n/u).at(-1)!)).toMatchObject({
    status: 'migration_required',
    diagnostic: 'change-lifecycle-run-required',
    replacementCommand: 'run.archive.refresh',
  });
  expect(await git(workspace.remote, 'rev-parse', `refs/heads/${sourceBranch}`)).toBe(sourceOid);
  expect(JSON.parse(await readFile(mergeRequestStateFile, 'utf8'))).toMatchObject({ created: 0 });

  const executed = await execFileAsync(process.execPath, [executable, inputFile, 'resume'], {
    cwd: productRoot,
    env: environment,
    timeout: 45_000,
  });
  const result = JSON.parse(executed.stdout.trim().split(/\r?\n/u).at(-1)!) as {
    status: string;
    diagnostic: string;
  };
  expect(result).toMatchObject({
    status: 'migration_required',
    diagnostic: 'change-lifecycle-run-required',
  });
  expect(await git(workspace.remote, 'rev-parse', `refs/heads/${sourceBranch}`)).toBe(sourceOid);

  const mergeRequestState = JSON.parse(await readFile(mergeRequestStateFile, 'utf8')) as {
    created: number;
    mergeRequests: Array<{
      sourceBranch: string;
      targetBranch: string;
      title: string;
    }>;
  };
  expect(mergeRequestState).toMatchObject({
    created: 0,
    mergeRequests: [],
  });
  expect(await git(workspace.source, 'rev-parse', 'HEAD')).toBe(sourceOid);
  expect(await git(workspace.source, 'status', '--porcelain')).toBe('');
}, 60_000);
