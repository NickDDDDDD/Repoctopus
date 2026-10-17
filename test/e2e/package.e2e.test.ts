import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
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
const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function npm(args: string[], cwd: string) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is unavailable');
  return execFileAsync(process.execPath, [npmCli, ...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe('published package', () => {
  it('installs with production dependencies and runs the JSON protocol', async () => {
    const root = await temporaryDirectory('repoctopus-package-');
    cleanup.push(root);
    const packDirectory = path.join(root, 'pack');
    const installation = path.join(root, 'installation');
    await mkdir(packDirectory);
    const packed = await npm(
      ['pack', '--json', '--pack-destination', packDirectory],
      repositoryRoot,
    );
    const archives = JSON.parse(packed.stdout) as Array<{ filename: string }>;
    const archive = path.join(packDirectory, archives[0]!.filename);
    await npm(['init', '-y'], root);
    await npm(
      ['install', '--ignore-scripts', '--omit=dev', '--prefix', installation, archive],
      root,
    );

    const project = path.join(root, 'project');
    const workspace = path.join(project, 'workspace');
    await createGitRepository(project, 'service');
    await createGitRepository(project, 'workspace');
    const installedPackage = path.join(installation, 'node_modules', 'repoctopus');
    const envelope = await runCli({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['project', 'probe', '--root', project, '--workspace', workspace],
    });
    expect(envelope).toMatchObject({ protocolVersion: 1, ok: true, command: 'project probe' });
    expect(JSON.stringify(envelope)).toContain('service');
    const started = await runCli({
      packageRoot: installedPackage,
      cwd: workspace,
      args: [
        'run',
        'start',
        '--workspace',
        workspace,
        '--project-root',
        project,
        '--run',
        'run-package-e2e',
      ],
    });
    expect(started.ok).toBe(true);
    const doctor = await runCli({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['doctor', '--workspace', workspace, '--run', 'run-package-e2e'],
    });
    expect(doctor.result).toMatchObject({ healthy: true, provenanceFiles: 10 });
    let failure: { code?: number; stderr?: string } | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [path.join(installedPackage, 'bin', 'repoctopus.js'), 'run', 'status', '--json'],
        { cwd: workspace },
      );
    } catch (error) {
      failure = error as { code?: number; stderr?: string };
    }
    expect(failure?.code).toBe(1);
    expect(JSON.parse(failure?.stderr ?? '{}')).toMatchObject({
      protocolVersion: 1,
      ok: false,
      command: 'run status',
      diagnostics: [{ code: 'cli.command-failed' }],
    });
    expect(
      await readFile(path.join(installedPackage, 'third_party', 'comet', 'LICENSE'), 'utf8'),
    ).toContain('MIT License');
  }, 120_000);
});
