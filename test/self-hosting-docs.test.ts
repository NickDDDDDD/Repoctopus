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

function markdownSection(documentation: string, heading: string): string {
  const marker = `### ${heading}`;
  const start = documentation.indexOf(marker);
  if (start === -1) return '';

  const contentStart = start + marker.length;
  const remaining = documentation.slice(contentStart);
  const nextHeading = remaining.search(/^###\s/mu);
  return nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
}

function expectCommandsInOrder(section: string, commands: string[]): void {
  let previous = -1;
  for (const command of commands) {
    const position = section.indexOf(command);
    expect(position, `missing command: ${command}`).toBeGreaterThan(previous);
    previous = position;
  }
}

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

  it('makes isolated packages the acceptance default and guards direct-source diagnostics', async () => {
    const documentation = await readFile(
      path.join(repositoryRoot, 'docs', 'self-hosting.md'),
      'utf8',
    );
    const packageFirstHeading = '多仓验收默认：隔离安装包';
    const directSourceHeading = '诊断例外：直接运行源码';
    const packageFirst = markdownSection(documentation, packageFirstHeading);
    const directSource = markdownSection(documentation, directSourceHeading);

    expect(packageFirst).not.toBe('');
    expect(directSource).not.toBe('');
    expect(documentation.indexOf(packageFirstHeading)).toBeLessThan(
      documentation.indexOf(directSourceHeading),
    );
    expectCommandsInOrder(packageFirst, [
      'npm run build',
      'npm pack --json --pack-destination',
      'npm install --ignore-scripts --omit=dev --prefix',
      'node (Join-Path $consumerDirectory',
    ]);
    expectCommandsInOrder(directSource, [
      'npm run build',
      'node scripts/build.mjs --check',
      'node bin/repoctopus.js',
    ]);
    expect(directSource).toContain('每次切换、拉取或合入源码后');
    expect(directSource).toContain('历史 `dist/`');
    expect(directSource).toContain('不能作为验证证据');
    expect(documentation).toContain('Continuous integration / verify');
    expect(documentation).toContain('required check');
  });
});
