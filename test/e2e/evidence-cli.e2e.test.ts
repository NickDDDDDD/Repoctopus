import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import {
  commitGitRepository,
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('evidence CLI', () => {
  it('plans, runs, inspects, resumes and cleans a configured command profile', async () => {
    const root = await temporaryDirectory('repoctopus-evidence-cli-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'app');
    const workspace = await createGitRepository(root, 'workspace');
    const config: SharedProjectConfig = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'evidence-cli', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        { id: 'app', path: '../app' },
      ],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'build',
              type: 'command',
              repository: 'app',
              dependsOn: [],
              required: true,
              executable: process.execPath,
              args: ['-e', "process.stdout.write('verified')"],
              timeoutMs: 5000,
              cache: false,
            },
          ],
        },
      ],
    };
    await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await commitGitRepository(workspace, 'configure workspace');

    const planned = await runCli({
      packageRoot,
      cwd: workspace,
      args: ['evidence', 'plan', '--workspace', workspace, '--profile', 'verify'],
    });
    expect(planned).toMatchObject({
      protocolVersion: 1,
      ok: true,
      command: 'evidence plan',
      result: { plan: { profileId: 'verify', order: ['build'] } },
    });

    const attemptId = 'evidence-cli-attempt';
    const run = await runCli({
      packageRoot,
      cwd: workspace,
      args: [
        'evidence',
        'run',
        '--workspace',
        workspace,
        '--profile',
        'verify',
        '--attempt',
        attemptId,
      ],
    });
    expect(run).toMatchObject({
      ok: true,
      command: 'evidence run',
      runId: attemptId,
      result: {
        attempt: { status: 'completed' },
        bundle: { outcome: 'passed' },
        gate: { status: 'satisfied', outcome: 'passed' },
      },
    });

    for (const command of ['status', 'resume', 'inspect'] as const) {
      const envelope = await runCli({
        packageRoot,
        cwd: workspace,
        args: ['evidence', command, '--workspace', workspace, '--attempt', attemptId],
      });
      expect(envelope).toMatchObject({
        protocolVersion: 1,
        ok: true,
        command: `evidence ${command}`,
        runId: attemptId,
        result: {
          bundle: { outcome: 'passed' },
          gate: { status: 'satisfied', outcome: 'passed' },
        },
      });
    }

    const cleaned = await runCli({
      packageRoot,
      cwd: workspace,
      args: [
        'evidence',
        'clean',
        '--workspace',
        workspace,
        '--max-age-days',
        '0',
        '--max-bytes',
        '0',
      ],
    });
    expect(cleaned).toMatchObject({ ok: true, command: 'evidence clean' });
    expect(await execFileAsync('git', ['status', '--porcelain'], { cwd: repository })).toEqual(
      expect.objectContaining({ stdout: '' }),
    );
  }, 30_000);

  it('returns a stable failure envelope and exit code for invalid input', async () => {
    const root = await temporaryDirectory('repoctopus-evidence-cli-error-');
    cleanup.push(root);
    let failure: { code?: number; stderr?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          path.join(packageRoot, 'bin', 'repoctopus.js'),
          'evidence',
          'status',
          '--workspace',
          root,
          '--json',
        ],
        { cwd: root },
      );
    } catch (error) {
      failure = error as { code?: number; stderr?: string };
    }
    expect(failure?.code).toBe(1);
    expect(JSON.parse(failure?.stderr ?? '{}')).toMatchObject({
      protocolVersion: 1,
      ok: false,
      command: 'evidence status',
      diagnostics: [{ code: 'cli.command-failed' }],
    });
  });
});
