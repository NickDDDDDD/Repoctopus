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
    const inspectedSpecification = await runCli<{
      changeId: string;
      provider: { id: string; version: string };
    }>({
      packageRoot: installedPackage,
      cwd: repositoryRoot,
      args: [
        'spec',
        'inspect',
        '--workspace',
        repositoryRoot,
        '--change',
        'enable-self-hosted-development',
      ],
    });
    expect(inspectedSpecification.result).toMatchObject({
      changeId: 'enable-self-hosted-development',
      provider: { id: 'openspec', version: '1.14.3' },
    });
    const validatedSpecification = await runCli<{ valid: boolean; strict: boolean }>({
      packageRoot: installedPackage,
      cwd: repositoryRoot,
      args: [
        'spec',
        'validate',
        '--workspace',
        repositoryRoot,
        '--change',
        'enable-self-hosted-development',
      ],
    });
    expect(validatedSpecification.result).toMatchObject({ valid: true, strict: true });
    const envelope = await runCli({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['project', 'detect', '--scan-root', project, '--workspace', workspace],
    });
    expect(envelope).toMatchObject({ protocolVersion: 1, ok: true, command: 'project detect' });
    expect(JSON.stringify(envelope)).toContain('service');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'package-e2e', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: 'service', path: '../service' },
        ],
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
    const skillCatalog = await runCli<{
      apiVersion: string;
      complete: boolean;
      skills: Array<{ name: string }>;
    }>({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['skill', 'list', '--workspace', workspace, '--audience', 'user'],
    });
    expect(skillCatalog.ok).toBe(true);
    expect(skillCatalog.command).toBe('skill list');
    expect(skillCatalog.result?.apiVersion).toBe('repoctopus.skill/v1alpha1');
    expect(skillCatalog.result?.complete).toBe(true);
    expect(skillCatalog.result?.skills.map((skill) => skill.name)).toContain('tdd');
    const loadedSkill = await runCli<{ skill: { name: string; provider: string } }>({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['skill', 'get', '--workspace', workspace, '--audience', 'user', '--name', 'tdd'],
    });
    expect(loadedSkill.ok).toBe(true);
    expect(loadedSkill.command).toBe('skill get');
    expect(loadedSkill.result?.skill).toMatchObject({
      name: 'tdd',
      provider: 'matt-builtins',
    });
    const projectedSkills = await runCli<{ target: string; managedFiles: number }>({
      packageRoot: installedPackage,
      cwd: workspace,
      args: ['skill', 'project', '--workspace', workspace, '--target', 'opencode'],
    });
    expect(projectedSkills.ok).toBe(true);
    expect(projectedSkills.command).toBe('skill project');
    expect(projectedSkills.result?.target).toBe('opencode');
    expect(projectedSkills.result?.managedFiles).toBeGreaterThan(0);
    expect(
      await readFile(path.join(workspace, '.opencode', 'skills', 'tdd', 'SKILL.md'), 'utf8'),
    ).toContain('repoctopus/provider: matt-builtins');
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
    expect(packagedText).not.toMatch(/agent-lab/iu);
    expect(packagedText).not.toMatch(/C:\\Users\\User|\/Users\/[^/\s]+\//u);
    expect(await readdir(path.join(installedPackage, 'docs', 'schemas'))).toContain(
      'project-config.schema.json',
    );
  }, 120_000);
});
