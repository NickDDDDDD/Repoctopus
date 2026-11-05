import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunStatusView } from '../../domains/runtime/types.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';
import type { CliResult } from './cli.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function runCliFailure(options: Parameters<typeof runCli>[0]): Promise<CliResult> {
  try {
    await runCli(options);
  } catch (error) {
    const output =
      (error as { stdout?: string; stderr?: string }).stdout ||
      (error as { stderr?: string }).stderr;
    if (output) return JSON.parse(output) as CliResult;
    throw error;
  }
  throw new Error('Expected CLI command to fail');
}

describe('Change Run CLI', () => {
  it('converges concurrent create-or-resume calls on one stable Open Run', async () => {
    const root = await temporaryDirectory('repoctopus-change-run-cli-');
    cleanup.push(root);
    const remote = path.join(root, 'workspace.git');
    await mkdir(remote);
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
    const workspace = await createGitRepository(root, 'workspace', remote);
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
    const serviceRemote = path.join(root, 'service.git');
    await mkdir(serviceRemote);
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main'], {
      cwd: serviceRemote,
    });
    const service = await createGitRepository(root, 'service', serviceRemote);
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: service });
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

    const startOptions = {
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
    };
    const rejectedOnTarget = await runCliFailure(startOptions);
    expect(rejectedOnTarget).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.workspace-binding.source-target-equal' }],
    });
    const runsBeforeFeature = await readdir(path.join(workspace, '.repoctopus', 'runs')).catch(
      () => [],
    );
    expect(runsBeforeFeature).toEqual([]);

    await execFileAsync('git', ['switch', '-c', 'spec/stable-create-or-resume'], {
      cwd: workspace,
    });
    await execFileAsync(
      'git',
      ['push', '--set-upstream', 'origin', 'spec/stable-create-or-resume'],
      { cwd: workspace },
    );

    const start = () =>
      runCli<RunStatusView>({
        ...startOptions,
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
      definition: { id: 'repoctopus-change', version: '4.9.0' },
    });
    const firstLifecycle = first.result!.changeLifecycle!;
    const secondLifecycle = second.result!.changeLifecycle!;
    expect(secondLifecycle).toMatchObject({
      identity: firstLifecycle.identity,
      definition: firstLifecycle.definition,
      phase: firstLifecycle.phase,
      status: firstLifecycle.status,
      currentWork: firstLifecycle.currentWork,
    });

    const status = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'status', '--workspace', workspace, '--run', first.runId!],
      environment,
    });
    expect(status.result?.changeLifecycle).toMatchObject({ phase: 'open', status: 'running' });
    expect(status.result?.continuation).toMatchObject({
      schemaVersion: 2,
      continuation: 'execute',
      reason: 'work-unclaimed',
      attempt: null,
      checkEpoch: 0,
    });
    expect(typeof status.result?.continuation?.workId).toBe('string');
    const repeatedStatus = await runCli<RunStatusView>({
      packageRoot,
      cwd: workspace,
      args: ['run', 'status', '--workspace', workspace, '--run', first.runId!],
      environment,
    });
    expect(repeatedStatus.result?.continuation).toEqual(status.result?.continuation);
    expect(repeatedStatus.result?.trajectoryLength).toBe(status.result?.trajectoryLength);
    expect(status.result?.state.trigger?.facts).toMatchObject({
      specificationRoot: {
        storeId: 'team-platform',
        repositoryId: 'workspace',
      },
      targetBranch: { targetBranch: 'main', remote: 'origin' },
      changeStartBinding: {
        workspaceRepositoryId: 'workspace',
        sourceBranch: 'spec/stable-create-or-resume',
        targetBranch: 'main',
      },
      repositoryIds: ['service', 'workspace'],
    });

    const runDirectories = await readdir(path.join(workspace, '.repoctopus', 'runs'));
    expect(runDirectories).toEqual([first.runId]);

    const store = new FileRuntimeStore(workspace);
    const beforeConflict = await store.loadRun(first.runId!);
    const trajectoryBeforeConflict = await store.loadTrajectory(first.runId!);
    await execFileAsync('git', ['switch', '-c', 'spec/other-source'], { cwd: workspace });
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'spec/other-source'], {
      cwd: workspace,
    });
    const conflict = await runCliFailure(startOptions);
    expect(conflict).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'runtime.workspace-binding-conflict' }],
    });
    expect(await store.loadRun(first.runId!)).toEqual(beforeConflict);
    expect(await store.loadTrajectory(first.runId!)).toEqual(trajectoryBeforeConflict);

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
  }, 60_000);
});
