import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { probeProject } from '../../platform/git/probe.js';
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
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const project = await probeProject({ root, workspaceRoot: workspace });
    const repository = project.repositories.find((item) => item.name === 'app')!;
    const policyFile = path.join(workspace, 'delivery-policy.yaml');
    const intentFile = path.join(workspace, 'intent.yaml');
    const reportFile = path.join(app, 'verification.md');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusProject',
        project: { id: 'delivery-cli' },
        repositories: [{ id: repository.id, path: '../app' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: repository.id,
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
      `schemaVersion: 1\nchangeId: delivery-cli-change\nrepositories:\n  - repositoryId: ${repository.id}\n    sourceBranch: feat/change\n    targetBranch: main\n    commitMessage: 'feat: checkpoint change'\n    actions: [push, merge_request]\n`,
    );
    await writeFile(reportFile, '# Verification\nPassed\n');
    await writeFile(path.join(app, 'feature.txt'), 'feature');
    const common = [
      '--workspace',
      workspace,
      '--project-root',
      root,
      '--intent',
      intentFile,
      '--policy',
      policyFile,
    ];
    const checkpoint = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['delivery', 'checkpoint', ...common],
    });
    expect(checkpoint).toMatchObject({
      ok: true,
      command: 'delivery checkpoint',
      result: [{ created: true }],
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
