import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseSharedProjectConfig } from '../domains/project-configuration/config.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';
import { runCli } from './e2e/cli.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('self-hosting documentation', () => {
  it('keeps local links and the short-lived project configuration valid', async () => {
    const documentationPath = path.join(repositoryRoot, 'docs', 'self-hosting.md');
    const documentation = await readFile(documentationPath, 'utf8');
    const links = [...documentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
      .map((match) => match[1]!)
      .filter((target) => !/^[a-z]+:/iu.test(target) && !target.startsWith('#'));
    for (const target of links) {
      await expect(
        access(path.resolve(path.dirname(documentationPath), target)),
      ).resolves.toBeUndefined();
    }
    const example = await readFile(
      path.join(repositoryRoot, 'docs', 'examples', 'repoctopus.yaml'),
      'utf8',
    );
    expect(() => parseSharedProjectConfig(parse(example) as unknown)).not.toThrow();
    expect(documentation).toContain('change reconcile');
    expect(documentation).not.toContain('runner start');
  });

  it('runs documented reconciliation as a bounded process without persistent files', async () => {
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
    const result = await runCli({
      packageRoot: repositoryRoot,
      cwd: workspace,
      args: ['change', 'reconcile', '--workspace', workspace],
    });
    expect(result).toMatchObject({ ok: true, command: 'change reconcile', result: { checked: 0 } });
  });
});
