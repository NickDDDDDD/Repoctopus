import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('delivery CLI', () => {
  it('checkpoints and prepares an approval request without accepting non-interactive approval', async () => {
    const root = await temporaryDirectory('repoctopus-delivery-cli-');
    cleanup.push(root);
    const remote = path.join(root, 'remote.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare'], { cwd: remote });
    const app = await createGitRepository(root, 'app', remote);
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: app });
    await execFileAsync('git', ['switch', '-c', 'feat/change'], { cwd: app });
    const workspace = await createGitRepository(root, 'workspace');
    const repositoryId = 'app';
    const policyFile = path.join(workspace, 'delivery-policy.yaml');
    const intentFile = path.join(workspace, 'intent.yaml');
    const reportFile = path.join(app, 'verification.md');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'delivery-cli', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: repositoryId, path: '../app' },
        ],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: repositoryId,
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );
    await writeFile(
      policyFile,
      `apiVersion: repoctopus/v1alpha1\nkind: DeliveryPolicy\ncheckpoint:\n  automatic: true\n  protectedBranches: [main]\n  commitMessagePattern: '^feat: .+'\n  quickChecks: {}\npublication:\n  remote: origin\n  provider: github\n  githubApiBaseUrl: https://api.github.com\n  mrTitleTemplate: '{{changeId}}'\n  mrBodyTemplate: '{{verificationReport}}'\n`,
    );
    await writeFile(
      intentFile,
      `schemaVersion: 2\nchangeId: delivery-cli-change\ncoordinationMergeRequest:\n  repositoryId: coordination-repository\n  remoteIdentity: github.com/team/coordination-repository\n  sourceBranch: feat/delivery-cli-change\n  targetBranch: main\n  mergeRequest:\n    provider: github\n    repositoryId: coordination-repository\n    number: 1\n    url: https://github.com/team/coordination-repository/pull/1\nrepositories:\n  - repositoryId: ${repositoryId}\n    sourceBranch: feat/change\n    targetBranch: main\n    commitMessage: 'feat: checkpoint change'\n    actions: [push, merge_request]\n`,
    );
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await execFileAsync(
      'git',
      ['add', 'repoctopus.yaml', 'delivery-policy.yaml', 'intent.yaml', '.gitignore'],
      { cwd: workspace },
    );
    await execFileAsync('git', ['commit', '-m', 'chore: configure delivery workspace'], {
      cwd: workspace,
    });
    await writeFile(reportFile, '# Verification\nPassed\n');
    await writeFile(path.join(app, 'feature.txt'), 'feature');
    const common = ['--workspace', workspace, '--intent', intentFile, '--policy', policyFile];
    const checkpoint = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['delivery', 'checkpoint', ...common],
    });
    expect(checkpoint).toMatchObject({
      ok: true,
      command: 'delivery checkpoint',
      result: [
        {
          created: true,
          publication: {
            remote: 'origin',
            branch: 'feat/change',
            upstream: 'origin/feat/change',
          },
        },
      ],
    });
    const evidence = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['evidence', 'run', '--workspace', workspace, '--profile', 'verify'],
    });
    expect(evidence).toMatchObject({
      ok: true,
      result: { bundle: { outcome: 'passed' } },
    });
    const bundleId = (evidence.result as { bundle: { bundleId: string } }).bundle.bundleId;
    const prepared = await runCli({
      packageRoot,
      cwd: workspace,
      args: [
        'delivery',
        'prepare',
        ...common,
        '--report',
        reportFile,
        '--evidence-bundles',
        bundleId,
      ],
    });
    expect(prepared).toMatchObject({
      ok: true,
      command: 'delivery prepare',
      result: { status: 'awaiting_approval', decisionRequest: { kind: 'HumanDecisionRequest' } },
    });
    const status = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['delivery', 'status', '--workspace', workspace, '--change', 'delivery-cli-change'],
    });
    expect(status).toMatchObject({ result: { status: 'awaiting_approval' } });
    let failure: { code?: number; stderr?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          path.join(packageRoot, 'bin', 'repoctopus.js'),
          'approval',
          'review',
          '--workspace',
          workspace,
          '--change',
          'delivery-cli-change',
          '--json',
        ],
        { cwd: workspace },
      );
    } catch (error) {
      failure = error as { code?: number; stderr?: string };
    }
    expect(failure?.code).toBe(1);
    const errorEnvelope = JSON.parse(failure?.stderr ?? '{}') as {
      diagnostics?: Array<{ message?: string }>;
    };
    expect(errorEnvelope.diagnostics?.[0]?.message).toMatch(/interactive terminal/i);
  }, 30_000);
});
