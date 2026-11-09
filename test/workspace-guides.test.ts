import { lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SharedProjectConfig } from '../domains/project-configuration/types.js';
import { renderWorkspaceGuides } from '../domains/project-configuration/workspace-guides.js';
import {
  installWorkspaceGuides,
  mergeWorkspaceGuide,
  planWorkspaceGuides,
} from '../platform/project-configuration/workspace-guides.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const config: SharedProjectConfig = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'RepoctopusWorkspace',
  workspace: { id: 'team', repositoryId: 'workspace' },
  repositories: [
    { id: 'workspace', path: '.' },
    { id: 'web', path: '../web' },
  ],
  profiles: [],
  specificationProvider: {
    id: 'specification-openspec',
    store: { id: 'team-store', repositoryId: 'workspace' },
  },
};
const guide = {
  file: 'README.md',
  tag: 'repoctopus-workspace',
  content: '## Workflow\n\nUse runtime.',
};
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));
async function root() {
  const directory = await temporaryDirectory('repoctopus-guides-');
  cleanup.push(directory);
  return directory;
}

describe('Workspace guide ownership', () => {
  it('preserves exact mixed-ending user prefix/suffix and does not duplicate its own block', () => {
    const prefix = '# Team\r\n\nKeep this exactly.\r\n';
    const suffix = '\r\n\n## Rules\nNo changes here.';
    const before = prefix + '<repoctopus-workspace>\r\nOld\r\n</repoctopus-workspace>' + suffix;
    const after = mergeWorkspaceGuide(before, guide);
    expect(after.startsWith(prefix)).toBe(true);
    expect(after.endsWith(suffix)).toBe(true);
    expect(mergeWorkspaceGuide(after, guide)).toBe(after);
    expect(mergeWorkspaceGuide('No final newline', guide).startsWith('No final newline\n')).toBe(
      true,
    );
  });

  it('preserves a UTF-8 BOM outside an existing managed block', () => {
    const before = '\uFEFF<repoctopus-workspace>\r\nOld\r\n</repoctopus-workspace>\r\n';
    expect(mergeWorkspaceGuide(before, guide).startsWith('\uFEFF<repoctopus-workspace>\r\n')).toBe(
      true,
    );
  });

  it.each([
    '<repoctopus-workspace>\nIncomplete',
    '</repoctopus-workspace>\nOrphan',
    '<repoctopus-workspace>\n<repoctopus-workspace>\n</repoctopus-workspace>',
    '<repoctopus-workspace>\nA\n</repoctopus-workspace>\n<repoctopus-workspace>\nB\n</repoctopus-workspace>',
    '</repoctopus-workspace>\n<repoctopus-workspace>',
    '<repoctopus-workspace >\nOld\n</repoctopus-workspace >',
    '<repoctopus-workspace/>',
  ])('rejects ambiguous ownership rather than editing malformed blocks: %s', (before) => {
    expect(() => mergeWorkspaceGuide(before, guide)).toThrow(/managed block/u);
  });

  it('installs portable linked guides, preserves project content and skips unchanged writes', async () => {
    const workspace = await root();
    const userReadme = '# Team\r\nLocal text without trailing newline';
    const userRules = '# Agent rules\nUse team conventions.\n';
    await writeFile(path.join(workspace, 'README.md'), userReadme);
    await writeFile(path.join(workspace, 'AGENTS.md'), userRules);
    await installWorkspaceGuides(workspace, await planWorkspaceGuides(workspace, config));
    expect(await readFile(path.join(workspace, 'README.md'), 'utf8')).toContain(userReadme);
    expect(await readFile(path.join(workspace, 'AGENTS.md'), 'utf8')).toContain(userRules);
    const before = await lstat(path.join(workspace, 'README.md'));
    await installWorkspaceGuides(workspace, await planWorkspaceGuides(workspace, config));
    expect((await lstat(path.join(workspace, 'README.md'))).mtimeMs).toBe(before.mtimeMs);
    const tutorial = await readFile(
      path.join(workspace, 'docs/repoctopus/workspace-guide.md'),
      'utf8',
    );
    expect(tutorial).toContain("--store 'team-store'");
    expect(tutorial).toContain('run resume');
    expect(tutorial).not.toContain(workspace);
  });

  it('refuses invalid UTF-8 rather than corrupting user bytes', async () => {
    const workspace = await root();
    const bytes = Buffer.from([0xff, 0x61, 0x62]);
    await writeFile(path.join(workspace, 'README.md'), bytes);
    await expect(planWorkspaceGuides(workspace, config)).rejects.toThrow(/UTF-8/u);
    expect(await readFile(path.join(workspace, 'README.md'))).toEqual(bytes);
  });

  it('refuses a same-content file replacement after planning', async () => {
    const workspace = await root();
    const file = path.join(workspace, 'README.md');
    await writeFile(file, '# Original\n');
    const plan = await planWorkspaceGuides(workspace, config);
    await rename(file, path.join(workspace, 'original.md'));
    await writeFile(file, '# Original\n');
    await expect(installWorkspaceGuides(workspace, plan)).rejects.toThrow(/changed/u);
    expect(await readFile(file, 'utf8')).toBe('# Original\n');
  });

  it('does not overwrite a file created after planning', async () => {
    const workspace = await root();
    const plan = await planWorkspaceGuides(workspace, config);
    await writeFile(path.join(workspace, 'README.md'), 'Concurrent user content');
    await expect(installWorkspaceGuides(workspace, plan)).rejects.toThrow(/changed/u);
    expect(await readFile(path.join(workspace, 'README.md'), 'utf8')).toBe(
      'Concurrent user content',
    );
  });

  it('rechecks all materialized guides when a later write changes an earlier file', async () => {
    const workspace = await root();
    const plan = await planWorkspaceGuides(workspace, config);
    await expect(
      installWorkspaceGuides(workspace, plan, async (file) => {
        if (file === 'AGENTS.md')
          await writeFile(path.join(workspace, 'README.md'), '# Concurrent team edit');
      }),
    ).rejects.toThrow(/guide.*changed|guide.*materialized/iu);
    expect(await readFile(path.join(workspace, 'README.md'), 'utf8')).toBe(
      '# Concurrent team edit',
    );
  });

  it('rejects symlink targets and unsafe parents without touching their contents', async () => {
    const workspace = await root();
    const outside = await root();
    const original = path.join(outside, 'README.md');
    await writeFile(original, 'Outside');
    await symlink(
      outside,
      path.join(workspace, 'docs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(planWorkspaceGuides(workspace, config)).rejects.toThrow(/regular contained path/u);
    expect(await readFile(original, 'utf8')).toBe('Outside');
    const other = await root();
    await mkdir(path.join(other, 'AGENTS.md'));
    await expect(planWorkspaceGuides(other, config)).rejects.toThrow(/regular contained path/u);
  });

  it('renders single-repository use without exposing local paths or configured credentials', () => {
    const rendered = renderWorkspaceGuides({
      ...config,
      repositories: [{ id: 'workspace', path: 'C:/private/project' }],
      telemetry: { endpoint: 'https://secret-collector.example/actual' },
    });
    expect(rendered[2]!.content).toContain('单仓');
    expect(JSON.stringify(rendered)).not.toContain('C:/private');
    expect(JSON.stringify(rendered)).not.toContain('secret-collector');
  });
});
