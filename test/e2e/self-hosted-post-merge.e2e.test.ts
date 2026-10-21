import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { afterEach, expect, it } from 'vitest';

import { compileRunnerComposition } from '../../app/boot/project-composition.js';
import type { DeliveryEvent } from '../../domains/delivery/ports.js';
import type {
  DeliveryMergeRequestSet,
  DeliveryRepositoryFacts,
  DeliveryState,
  MergeRequestStatus,
} from '../../domains/delivery/types.js';
import { FileDeliveryStore } from '../../platform/delivery/file-delivery-store.js';
import { normalizeRemoteIdentity } from '../../platform/git/remote-identity.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { createRepoctopusBuiltinCatalog } from '../../plugins/builtin-catalog.js';
import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const productRoot = path.resolve(import.meta.dirname, '..', '..');
const roots: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  await Promise.all(processes.splice(0).map(terminate));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[]): Promise<string> {
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

async function createRepository(root: string, id: string) {
  const remote = path.join(root, 'remotes', `${id}.git`);
  const source = path.join(root, id);
  await mkdir(path.dirname(remote), { recursive: true });
  await git(root, ['init', '--bare', '--initial-branch=main', remote]);
  await mkdir(source, { recursive: true });
  await git(source, ['init', '--initial-branch=main']);
  await git(source, ['config', 'user.name', 'Repoctopus E2E']);
  await git(source, ['config', 'user.email', 'repoctopus-e2e@example.invalid']);
  await writeFile(path.join(source, 'VERSION.txt'), 'merged\n');
  await git(source, ['add', '.']);
  await git(source, ['commit', '-m', 'initial merged state']);
  const remoteUrl = pathToFileURL(remote).href;
  await git(source, ['remote', 'add', 'origin', remoteUrl]);
  await git(source, ['push', '--set-upstream', 'origin', 'main']);
  return {
    id,
    source,
    remote,
    remoteUrl,
    remoteIdentity: normalizeRemoteIdentity(remoteUrl),
    mergeCommit: await git(source, ['rev-parse', 'HEAD']),
    tree: await git(source, ['rev-parse', 'HEAD^{tree}']),
  };
}

async function writeSpecification(workspace: string, changeId: string): Promise<void> {
  const files = new Map([
    [
      'openspec/specs/post-merge-automation/spec.md',
      `# Post-merge automation

## Purpose
Exercise the independent-process closure.

## Requirements

### Requirement: Existing behavior
The system MUST preserve the existing behavior.

#### Scenario: Existing behavior runs
- **WHEN** the workflow runs
- **THEN** it succeeds
`,
    ],
    [
      `openspec/changes/${changeId}/proposal.md`,
      `# Change: ${changeId}

## Why
Exercise the self-hosted close path.

## What Changes
- Extend post-merge automation.

## Capabilities
- \`post-merge-automation\`: extend the fixture behavior.

## Impact
- E2E fixture only.
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
- Modify business source.

## Decisions
Use the guarded post-merge path.
`,
    ],
    [`openspec/changes/${changeId}/tasks.md`, '# Tasks\n\n- [x] 1.1 Complete E2E.\n'],
    [
      `openspec/changes/${changeId}/specs/post-merge-automation/spec.md`,
      `# Spec Delta

## ADDED Requirements

### Requirement: Independent-process closure
The system MUST recover the self-hosted close path.

#### Scenario: Runner restarts
- **WHEN** a persisted webhook is resumed
- **THEN** the change is archived once
`,
    ],
  ]);
  for (const [relative, contents] of files) {
    const target = path.join(workspace, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-self-hosted-e2e-'));
  const buildRoot = await mkdtemp(
    path.join(productRoot, 'node_modules', '.repoctopus-self-hosted-build-'),
  );
  roots.push(root, buildRoot);
  const app = await createRepository(root, 'app');
  const api = await createRepository(root, 'api');
  const workspaceRepository = await createRepository(root, 'workspace');
  const workspace = workspaceRepository.source;
  const changeId = 'self-hosted-post-merge';
  const sourceBranch = 'feat/self-hosted-post-merge';
  await git(workspace, ['checkout', '-b', sourceBranch]);
  await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
  await writeSpecification(workspace, changeId);
  const port = await availablePort();
  await writeFile(
    path.join(workspace, 'repoctopus.yaml'),
    `${JSON.stringify(
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'self-hosted-e2e', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: 'app', path: '../app' },
          { id: 'api', path: '../api' },
        ],
        profiles: [
          {
            id: 'post-merge',
            nodes: [
              {
                id: 'app-check',
                type: 'command',
                repository: 'app',
                executable: process.execPath,
                args: [
                  '-e',
                  "if (require('node:fs').readFileSync('VERSION.txt', 'utf8').trim() !== 'merged') process.exit(9)",
                ],
              },
              {
                id: 'api-check',
                type: 'command',
                repository: 'api',
                executable: process.execPath,
                args: [
                  '-e',
                  "if (require('node:fs').readFileSync('VERSION.txt', 'utf8').trim() !== 'merged') process.exit(9)",
                ],
              },
            ],
          },
        ],
        delivery: {
          checkpoint: {
            automatic: true,
            protectedBranches: ['main'],
            commitMessagePattern: '^(feat|fix|docs|refactor|test|chore)(\\([a-z0-9-]+\\))?: .+',
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
        specificationProvider: { id: 'specification-openspec' },
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
            maxAttempts: 5,
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
            operations: ['commit', 'push', 'merge_request.update'],
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
            changeMergeRequest: {
              mode: 'update-existing',
              title: 'Closed self-hosted specification',
              body: 'Post-merge verification completed.',
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await git(workspace, ['add', '.']);
  await git(workspace, ['commit', '-m', 'feat: configure self-hosted change']);
  await git(workspace, ['push', '--set-upstream', 'origin', sourceBranch]);
  const baselineHead = await git(workspace, ['rev-parse', 'HEAD']);

  const business = [app, api];
  const businessRecords = business.map((repository, index) => ({
    role: 'business' as const,
    repositoryId: repository.id,
    remoteIdentity: repository.remoteIdentity,
    sourceBranch: `feat/${repository.id}`,
    targetBranch: 'main',
    mergeRequest: {
      provider: 'github',
      repositoryId: repository.id,
      number: 11 + index,
      url: `https://mock.invalid/${repository.id}/pull/${11 + index}`,
    },
  }));
  const changeMergeRequestIdentity = {
    provider: 'github',
    repositoryId: 'workspace',
    number: 8,
    url: 'https://mock.invalid/workspace/pull/8',
  };
  const mergeRequests: DeliveryMergeRequestSet = {
    change: {
      role: 'change',
      repositoryId: 'workspace',
      remoteIdentity: workspaceRepository.remoteIdentity,
      sourceBranch,
      targetBranch: 'main',
      mergeRequest: changeMergeRequestIdentity,
    },
    business: businessRecords,
  };
  const facts: DeliveryRepositoryFacts[] = business.map((repository) => ({
    repositoryId: repository.id,
    repositoryName: repository.id,
    remoteIdentity: repository.remoteIdentity,
    sourceBranch: `feat/${repository.id}`,
    targetBranch: 'main',
    head: repository.mergeCommit,
    tree: repository.tree,
    remoteSourceOid: repository.mergeCommit,
    remoteTargetOid: repository.mergeCommit,
    clean: true,
  }));
  const config = await loadProjectConfig(workspace);
  const catalog = await createRepoctopusBuiltinCatalog(productRoot);
  const composition = compileRunnerComposition(productRoot, workspace, config, catalog);
  const snapshot = {
    schemaVersion: 2 as const,
    changeId,
    compositionDigest: composition.compositionDigest,
    digest: `sha256:${'1'.repeat(64)}`,
    reportDigest: `sha256:${'2'.repeat(64)}`,
    policyDigest: `sha256:${'3'.repeat(64)}`,
    intentDigest: `sha256:${'4'.repeat(64)}`,
    evidenceBundleIds: [`sha256:${'5'.repeat(64)}`],
    repositories: facts,
    mergeRequests,
    plan: [],
    createdAt: '2026-10-21T00:00:00.000Z',
  };
  const state: DeliveryState = {
    schemaVersion: 2,
    changeId,
    stateVersion: 1,
    status: 'in_review',
    snapshot,
    decisionRequest: null,
    approval: null,
    actionResults: [],
    mergeEvidence: [],
    mergeRequests,
    platformCapabilities: [],
    updatedAt: '2026-10-21T00:00:00.000Z',
  };
  const event: DeliveryEvent = {
    schemaVersion: 1,
    eventId: 'self-hosted-e2e-delivery',
    changeId,
    stateVersion: state.stateVersion,
    timestamp: state.updatedAt,
    type: 'delivery.refreshed',
    data: {},
  };
  await new FileDeliveryStore(workspace).commit({
    state,
    previousStateVersion: null,
    event,
  });

  const mockStateFile = path.join(root, 'mock-platform.json');
  const mockMergeRequests: MergeRequestStatus[] = [
    ...business.map((repository, index) => ({
      ...businessRecords[index]!.mergeRequest,
      state: 'merged' as const,
      sourceBranch: `feat/${repository.id}`,
      targetBranch: 'main',
      headCommit: repository.mergeCommit,
      title: repository.id,
      body: '',
      ci: 'passed' as const,
      review: 'approved' as const,
      conversationsResolved: true,
      mergeCommit: repository.mergeCommit,
      mergedAt: '2026-10-21T01:00:00.000Z',
    })),
    {
      ...changeMergeRequestIdentity,
      state: 'open',
      sourceBranch,
      targetBranch: 'main',
      headCommit: baselineHead,
      title: 'Self-hosted development',
      body: 'Awaiting post-merge closure.',
      ci: 'passed',
      review: 'approved',
      conversationsResolved: true,
      mergeCommit: null,
      mergedAt: null,
    },
  ];
  await writeFile(
    mockStateFile,
    `${JSON.stringify(
      {
        updates: 0,
        mergeRequests: mockMergeRequests.map((item) =>
          item.repositoryId === 'workspace'
            ? { ...item, remote: workspaceRepository.remote }
            : item,
        ),
      },
      null,
      2,
    )}\n`,
  );

  const executable = path.join(buildRoot, 'self-hosted-post-merge-process.mjs');
  await build({
    entryPoints: [path.join(productRoot, 'test', 'fixtures', 'self-hosted-post-merge-process.ts')],
    outfile: executable,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'silent',
  });
  return {
    root,
    workspace,
    executable,
    mockStateFile,
    business,
    workspaceRepository,
    changeId,
    sourceBranch,
    baselineHead,
  };
}

function environment(mockStateFile: string, secret: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...process.env,
    REPOCTOPUS_MOCK_PLATFORM_STATE: mockStateFile,
    REPOCTOPUS_E2E_WEBHOOK_SECRET: secret,
    REPOCTOPUS_E2E_GITHUB_TOKEN: 'mock-token',
    REPOCTOPUS_E2E_AUTHOR_NAME: 'Repoctopus E2E',
    REPOCTOPUS_E2E_AUTHOR_EMAIL: 'repoctopus-e2e@example.invalid',
  };
  for (const key of Object.keys(result)) {
    if (key.startsWith('OTEL_EXPORTER_OTLP')) delete result[key];
  }
  return result;
}

function startRunner(input: {
  executable: string;
  workspace: string;
  mockStateFile: string;
  secret: string;
}) {
  const child = spawn(process.execPath, [input.executable, productRoot, input.workspace], {
    cwd: productRoot,
    env: environment(input.mockStateFile, input.secret),
  });
  processes.push(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  return {
    child,
    output: () => output,
    ready: new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Runner did not start: ${output}`)),
        15_000,
      );
      const inspect = () => {
        for (const line of output.split(/\r?\n/u)) {
          if (!line.startsWith('{')) continue;
          const value = JSON.parse(line) as { type?: string; origin?: string };
          if (value.type === 'ready' && value.origin) {
            clearTimeout(timeout);
            resolve(value.origin);
            return;
          }
        }
        setTimeout(inspect, 10);
      };
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Runner exited before ready (${code ?? signal}): ${output}`));
      });
      inspect();
    }),
  };
}

async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}

async function webhook(input: {
  origin: string;
  body: Buffer;
  secret: string;
  deliveryId: string;
}) {
  const signature = `sha256=${createHmac('sha256', input.secret).update(input.body).digest('hex')}`;
  const response = await fetch(new URL('/webhooks/github', input.origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': input.deliveryId,
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    },
    body: input.body,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function waitForCompletion(input: {
  workspace: string;
  envelopeId: string;
  environment: NodeJS.ProcessEnv;
  output: () => string;
}) {
  const deadline = Date.now() + 45_000;
  let last: unknown;
  while (Date.now() < deadline) {
    const status = await runCli<{ status: string; diagnostic: string | null; attempts: number }>({
      packageRoot: productRoot,
      cwd: input.workspace,
      args: ['event', 'status', '--workspace', input.workspace, '--envelope', input.envelopeId],
      environment: input.environment,
    });
    last = status.result;
    if (status.result?.status === 'completed') return status.result;
    if (status.result?.status === 'dead_letter') {
      throw new Error(
        `Post-merge event dead-lettered: ${JSON.stringify(status.result)}\n${input.output()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Post-merge event did not complete: ${JSON.stringify(last)}\n${input.output()}`);
}

it('recovers a signed multi-repository Post-merge run and publishes the Change MR branch', async () => {
  const setup = await fixture();
  const secret = 'self-hosted-e2e-secret';
  const first = startRunner({
    executable: setup.executable,
    workspace: setup.workspace,
    mockStateFile: setup.mockStateFile,
    secret,
  });
  const body = Buffer.from(
    JSON.stringify({
      action: 'closed',
      repository: { html_url: setup.business[0]!.remoteUrl },
      pull_request: { number: 11 },
    }),
  );
  const accepted = await webhook({
    origin: await first.ready,
    body,
    secret,
    deliveryId: 'self-hosted-e2e-delivery',
  });
  expect(accepted).toMatchObject({ status: 202, body: { accepted: true, duplicate: false } });
  const envelopeId = accepted.body.envelopeId as string;
  await terminate(first.child);

  const pending = await runCli<{ status: string; receipts: unknown[] }>({
    packageRoot: productRoot,
    cwd: setup.workspace,
    args: ['event', 'status', '--workspace', setup.workspace, '--envelope', envelopeId],
    environment: environment(setup.mockStateFile, secret),
  });
  expect(['pending', 'leased']).toContain(pending.result?.status);

  const restarted = startRunner({
    executable: setup.executable,
    workspace: setup.workspace,
    mockStateFile: setup.mockStateFile,
    secret,
  });
  await restarted.ready;
  const completed = await waitForCompletion({
    workspace: setup.workspace,
    envelopeId,
    environment: environment(setup.mockStateFile, secret),
    output: restarted.output,
  });
  expect(completed).toMatchObject({ status: 'completed', diagnostic: 'post-merge-completed' });

  const runIds = (await readdir(path.join(setup.workspace, '.repoctopus', 'runs'))).filter((id) =>
    id.startsWith('post-merge-'),
  );
  expect(runIds).toHaveLength(1);
  const run = await runCli<{ state: { status: string; acceptedEvidenceBundleIds: string[] } }>({
    packageRoot: productRoot,
    cwd: setup.workspace,
    args: ['run', 'status', '--workspace', setup.workspace, '--run', runIds[0]!],
    environment: environment(setup.mockStateFile, secret),
  });
  expect(run.result?.state.status).toBe('completed');
  expect(run.result?.state.acceptedEvidenceBundleIds).toHaveLength(1);

  const archiveRoot = path.join(setup.workspace, 'openspec', 'changes', 'archive');
  expect((await readdir(archiveRoot)).some((entry) => entry.endsWith(`-${setup.changeId}`))).toBe(
    true,
  );
  expect(
    await readFile(
      path.join(setup.workspace, 'openspec', 'specs', 'post-merge-automation', 'spec.md'),
      'utf8',
    ),
  ).toContain('Independent-process closure');
  const head = await git(setup.workspace, ['rev-parse', 'HEAD']);
  const remoteHead = await git(setup.workspaceRepository.remote, [
    'rev-parse',
    `refs/heads/${setup.sourceBranch}`,
  ]);
  expect(head).not.toBe(setup.baselineHead);
  expect(remoteHead).toBe(head);
  expect(await git(setup.workspace, ['status', '--porcelain'])).toBe('');

  const mockState = JSON.parse(await readFile(setup.mockStateFile, 'utf8')) as {
    updates: number;
    mergeRequests: MergeRequestStatus[];
  };
  expect(mockState.updates).toBe(1);
  expect(mockState.mergeRequests.find((item) => item.repositoryId === 'workspace')).toMatchObject({
    title: 'Closed self-hosted specification',
    body: 'Post-merge verification completed.',
  });
}, 60_000);
