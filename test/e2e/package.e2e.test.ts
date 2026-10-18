import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
    const archives = JSON.parse(packed.stdout) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;
    const packagedPaths = archives[0]!.files.map((file) => file.path.replaceAll('\\', '/'));
    expect(packagedPaths).toContain('docs/schemas/project-config.schema.json');
    expect(packagedPaths).toContain('docs/examples/repoctopus.gitignore');
    expect(packagedPaths).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/(^|\/)test\//u),
        expect.stringMatching(/(^|\/)openspec\//u),
        expect.stringMatching(/(^|\/)\.repoctopus\//u),
      ]),
    );
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
      args: ['project', 'detect', '--root', project, '--workspace', workspace],
    });
    expect(envelope).toMatchObject({ protocolVersion: 1, ok: true, command: 'project detect' });
    expect(JSON.stringify(envelope)).toContain('service');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusProject',
        project: { id: 'package-e2e' },
        repositories: [{ id: 'service', path: '../service' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'build',
                type: 'command',
                repository: 'service',
                executable: process.execPath,
                args: ['-e', "process.stdout.write('package verified')"],
                cache: false,
              },
            ],
          },
        ],
      }),
    );
    const started = await runCli({
      packageRoot: installedPackage,
      cwd: workspace,
      args: [
        'evidence',
        'run',
        '--workspace',
        workspace,
        '--profile',
        'verify',
        '--attempt',
        'package-e2e-attempt',
      ],
    });
    expect(started).toMatchObject({
      ok: true,
      result: { bundle: { outcome: 'passed' }, gate: { status: 'satisfied' } },
    });
    const inspected = await runCli({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['evidence', 'inspect', '--workspace', workspace, '--attempt', 'package-e2e-attempt'],
    });
    expect(inspected).toMatchObject({
      ok: true,
      result: {
        bundle: { outcome: 'passed' },
        journal: [{ type: 'node.intent' }, { type: 'node.completed' }],
      },
    });
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
    const textFiles = packagedPaths.filter((file) => /\.(?:js|json|md|ts|yaml|yml)$/u.test(file));
    const packagedText = (
      await Promise.all(
        textFiles.map(async (file) => {
          try {
            return await readFile(path.join(installedPackage, file), 'utf8');
          } catch {
            return '';
          }
        }),
      )
    ).join('\n');
    expect(packagedText).not.toMatch(/agent-lab|C:\\Users\\User|\/Users\//iu);
    expect(await readdir(path.join(installedPackage, 'docs', 'schemas'))).toContain(
      'project-config.schema.json',
    );
  }, 120_000);
});
