import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunStatusView } from '../../domains/runtime/types.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('Change Run CLI', () => {
  it('converges concurrent create-or-resume calls on one stable Open Run', async () => {
    const root = await temporaryDirectory('repoctopus-change-run-cli-');
    cleanup.push(root);
    const remote = path.join(root, 'workspace.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
    const workspace = await createGitRepository(root, 'workspace', remote);
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
    const service = await createGitRepository(root, 'service');
    const environment = await createOpenSpecStoreEnvironment(root, workspace, 'team-platform');
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      `${JSON.stringify(
        {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'RepoctopusWorkspace',
          workspace: { id: 'team-platform', repositoryId: 'workspace' },
          repositories: [
            { id: 'workspace', path: '.' },
            { id: 'service', path: '../service' },
          ],
          profiles: [
            {
              id: 'verify',
              nodes: [
                {
                  id: 'service-check',
                  type: 'command',
                  repository: 'service',
                  executable: process.execPath,
                  args: ['-e', 'process.exit(0)'],
                },
              ],
            },
          ],
          specificationProvider: {
            id: 'specification-openspec',
            store: { id: 'team-platform', repositoryId: 'workspace' },
          },
        },
        null,
        2,
      )}\n`,
    );
    await execFileAsync('git', ['add', '.'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'chore: configure Change Run fixture'], {
      cwd: workspace,
    });
    await execFileAsync('git', ['push', 'origin', 'main'], { cwd: workspace });

    const start = () =>
      runCli<RunStatusView>({
        packageRoot,
        cwd: workspace,
        args: [
          'run',
          'start',
          '--workspace',
          workspace,
          '--change',
          'stable-create-or-resume',
          '--target',
          'main',
        ],
        environment,
      });
    const [first, second] = await Promise.all([start(), start()]);

    expect(first.runId).toBe(second.runId);
    expect(first.result?.changeLifecycle).toMatchObject({
      identity: {
        workspaceId: 'team-platform',
        changeId: 'stable-create-or-resume',
      },
      phase: 'open',
      status: 'running',
      definition: { id: 'repoctopus-change', version: '3.0.0' },
    });
    expect(second.result?.changeLifecycle).toEqual(first.result?.changeLifecycle);

    const status = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'status', '--workspace', workspace, '--run', first.runId!],
      environment,
    });
    expect(status.result?.changeLifecycle).toMatchObject({ phase: 'open', status: 'running' });
    expect(status.result?.state.trigger?.facts).toMatchObject({
      specificationRoot: {
        storeId: 'team-platform',
        repositoryId: 'workspace',
      },
      targetBranch: { targetBranch: 'main', remote: 'origin' },
      repositoryIds: ['service', 'workspace'],
    });

    const runDirectories = await readdir(path.join(workspace, '.repoctopus', 'runs'));
    expect(runDirectories).toEqual([first.runId]);

    for (const obsolete of [
      ['--generation', '2'],
      ['--mode', 'adopt-existing'],
    ]) {
      await expect(
        runCli({
          packageRoot,
          cwd: workspace,
          args: [
            'run',
            'start',
            '--workspace',
            workspace,
            '--change',
            'stable-create-or-resume',
            ...obsolete,
            '--target',
            'main',
          ],
          environment,
        }),
      ).rejects.toThrow(/Unknown option/u);
    }

    await expect(
      runCli({
        packageRoot,
        cwd: workspace,
        args: [
          'run',
          'start',
          '--workspace',
          workspace,
          '--change',
          'missing-target',
          '--target',
          'does-not-exist',
        ],
        environment,
      }),
    ).rejects.toThrow(/target branch is not published/u);
    expect(service).toBe(path.join(root, 'service'));
  }, 30_000);
});
