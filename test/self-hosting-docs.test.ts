import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseSharedProjectConfig } from '../domains/project-configuration/config.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';
import { runCli } from './e2e/cli.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

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

async function readyEnvelope(child: ChildProcessWithoutNullStreams): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(
      () => reject(new Error(`Runner readiness timed out: ${stderr}`)),
      20_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as unknown);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Runner exited before readiness with code ${String(code)}: ${stderr}`));
    });
    child.once('error', reject);
  });
}

describe('self-hosting documentation', () => {
  it('keeps deployment links and the complete project configuration valid', async () => {
    const documentationPath = path.join(repositoryRoot, 'docs', 'self-hosting.md');
    const documentation = await readFile(documentationPath, 'utf8');
    const links = [...documentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
      .map((match) => match[1]!)
      .filter((target) => !/^[a-z]+:/iu.test(target) && !target.startsWith('#'));
    for (const target of links) {
      await expect(access(path.resolve(path.dirname(documentationPath), target))).resolves.toBe(
        undefined,
      );
    }

    const example = await readFile(
      path.join(repositoryRoot, 'docs', 'examples', 'repoctopus.yaml'),
      'utf8',
    );
    expect(() => parseSharedProjectConfig(parse(example) as unknown)).not.toThrow();
    expect(documentation).toContain('node bin/repoctopus.js runner start --workspace . --json');

    const platformEvents = await readFile(
      path.join(repositoryRoot, 'docs', 'platform-events.md'),
      'utf8',
    );
    const postMerge = await readFile(path.join(repositoryRoot, 'docs', 'post-merge.md'), 'utf8');
    expect(platformEvents).not.toContain('长期运行入口仍属于后续组合任务');
    expect(postMerge).not.toContain('尚未把 Post-merge Runner');
    expect(postMerge).toContain('post-merge reconcile');
    for (const unsupportedOwnerField of ['changeOwner', 'mrAuthor', 'branchAuthor']) {
      expect(documentation).toContain(unsupportedOwnerField);
    }
  });

  it('runs the documented one-shot reconciliation without an HTTP listener', async () => {
    const workspace = await temporaryDirectory('repoctopus-reconcile-docs-');
    cleanup.push(workspace);
    const example = await readFile(
      path.join(repositoryRoot, 'docs', 'examples', 'repoctopus.yaml'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      example.replace('path: ../app', 'path: .'),
    );

    const result = await runCli<{
      checked: number;
      completed: number;
      waiting: number;
      blocked: number;
      failed: number;
    }>({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['post-merge', 'reconcile', '--workspace', workspace],
    });
    expect(result).toMatchObject({
      ok: true,
      command: 'post-merge reconcile',
      result: { checked: 0, completed: 0, waiting: 0, blocked: 0, failed: 0 },
    });
  });

  it('starts the documented Runner command and emits a ready envelope', async () => {
    const workspace = await temporaryDirectory('repoctopus-self-hosting-docs-');
    cleanup.push(workspace);
    const port = await availablePort();
    const example = await readFile(
      path.join(repositoryRoot, 'docs', 'examples', 'repoctopus.yaml'),
      'utf8',
    );
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      example.replace('path: ../app', 'path: .').replace('port: 7341', `port: ${port}`),
    );

    const child = spawn(
      process.execPath,
      [
        path.join(repositoryRoot, 'bin', 'repoctopus.js'),
        'runner',
        'start',
        '--workspace',
        workspace,
        '--json',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          REPOCTOPUS_GITHUB_WEBHOOK_SECRET: 'self-hosting-docs-secret',
          REPOCTOPUS_GITHUB_TOKEN: 'self-hosting-docs-token',
          REPOCTOPUS_GIT_AUTHOR_NAME: 'Repoctopus Docs',
          REPOCTOPUS_GIT_AUTHOR_EMAIL: 'repoctopus-docs@example.invalid',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    try {
      await expect(readyEnvelope(child)).resolves.toMatchObject({
        ok: true,
        command: 'runner start',
        result: { status: 'ready', origin: `http://127.0.0.1:${port}` },
      });
    } finally {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exited;
    }
  }, 30_000);
});
