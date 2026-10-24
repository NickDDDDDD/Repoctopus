import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import type { DeliveryIntentV3 } from '../../domains/delivery/types.js';
import { normalizeRemoteIdentity } from '../../platform/git/remote-identity.js';
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

async function bareRemote(root: string, name: string): Promise<string> {
  const remote = path.join(root, name);
  await mkdir(remote);
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  return remote;
}

describe('Delivery v3 CLI', () => {
  it('fences the legacy prepare command in favor of the Change Run Archive', async () => {
    const root = await temporaryDirectory('repoctopus-delivery-v3-cli-');
    cleanup.push(root);
    const workspaceRemote = await bareRemote(root, 'workspace-remote.git');
    const appRemote = await bareRemote(root, 'app-remote.git');
    const workspace = await createGitRepository(root, 'workspace', workspaceRemote);
    const app = await createGitRepository(root, 'app', appRemote);
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: workspace });
    await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: app });
    await execFileAsync('git', ['switch', '-c', 'spec/delivery-v3-cli'], { cwd: workspace });
    await execFileAsync('git', ['switch', '-c', 'feat/delivery-v3-cli'], { cwd: app });

    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'delivery-v3-cli', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: 'app', path: '../app' },
        ],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'app',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
        delivery: {
          checkpoint: {
            automatic: true,
            protectedBranches: ['main'],
            commitMessagePattern: '^feat: .+',
            quickChecks: {},
          },
          publication: {
            remote: 'origin',
            provider: 'github',
            githubApiBaseUrl: 'https://api.github.test',
            mrTitleTemplate: '{{changeId}}',
            mrBodyTemplate: '{{verificationReport}}',
          },
        },
      }),
    );
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await execFileAsync('git', ['add', 'repoctopus.yaml', '.gitignore'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'chore: configure delivery v3'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push', '-u', 'origin', 'spec/delivery-v3-cli'], {
      cwd: workspace,
    });
    await writeFile(path.join(app, 'verification.md'), '# Verification\nPassed\n');
    await writeFile(path.join(app, 'feature.txt'), 'feature\n');
    await execFileAsync('git', ['add', 'verification.md', 'feature.txt'], { cwd: app });
    await execFileAsync('git', ['commit', '-m', 'feat: implement delivery v3'], { cwd: app });
    await execFileAsync('git', ['push', '-u', 'origin', 'feat/delivery-v3-cli'], { cwd: app });

    const workspaceOid = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace })
    ).stdout.trim();
    const changeBranch = {
      repositoryId: 'workspace',
      remoteIdentity: normalizeRemoteIdentity(workspaceRemote),
      sourceBranch: 'spec/delivery-v3-cli',
      targetBranch: 'main',
      remoteOid: workspaceOid,
    };
    const intentFile = path.join(root, 'delivery-v3.yaml');
    const intent = parse(
      await readFile(path.join(packageRoot, 'docs', 'examples', 'delivery-intent.yaml'), 'utf8'),
    ) as DeliveryIntentV3;
    intent.changeId = 'delivery-v3-cli';
    intent.changeBranch = changeBranch;
    intent.businessDeliveries = [
      {
        deliveryId: 'primary',
        repositoryId: 'app',
        sourceBranch: 'feat/delivery-v3-cli',
        targetBranch: 'main',
        commitMessage: 'feat: implement delivery v3',
        actions: ['push', 'merge_request'],
      },
    ];
    await writeFile(intentFile, stringify(intent));

    const prepareArgs = [
      'delivery',
      'prepare',
      '--workspace',
      workspace,
      '--intent',
      intentFile,
      '--policy',
      path.join(workspace, 'repoctopus.yaml'),
      '--report',
      path.join(app, 'verification.md'),
      '--evidence-bundles',
      'legacy-command-fence',
    ];
    const migrated = await runCli<{
      schemaVersion: 1;
      status: 'migration_required';
      diagnostic: string;
      replacementCommand: string;
    }>({
      packageRoot,
      cwd: workspace,
      args: prepareArgs,
    });
    expect(migrated).toMatchObject({
      ok: true,
      result: {
        schemaVersion: 1,
        status: 'migration_required',
        diagnostic: 'change-lifecycle-run-required',
        replacementCommand: 'run.archive.prepare',
      },
    });
  }, 30_000);
});
