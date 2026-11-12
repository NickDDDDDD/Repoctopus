import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { markWorkspaceEntrySkill } from '../domains/project-configuration/entry-skills.js';
import { captureWorkSkill } from '../platform/skill/snapshot.js';
import skillCatalogContributor from '../plugins/command/skill-catalog-contributor.js';
import { FileSkillProvider } from '../plugins/skill/file-skill-provider.js';
import filesystemSkillProvider from '../plugins/skill/filesystem-skill-provider.js';
import mattSkillProvider from '../plugins/skill/matt-skill-provider.js';
import { CommandRouter } from '../services/command-router.js';

const productRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'repoctopus-skill-workspace-'));
  const userSkillsRoot = await mkdtemp(path.join(tmpdir(), 'repoctopus-user-skills-'));
  temporaryRoots.push(workspaceRoot, userSkillsRoot);
  const context = new Context();
  await context.plugin(CommandRouter);
  await context.plugin(SkillRegistry);
  await context.plugin(mattSkillProvider, { productRoot });
  await context.plugin(filesystemSkillProvider, { workspaceRoot, userSkillsRoot });
  await context.plugin(skillCatalogContributor);
  return { context, workspaceRoot };
}

describe('Repoctopus Skill providers', () => {
  it('contains watcher errors that arrive after Windows-style asynchronous close', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-skill-watch-'));
    temporaryRoots.push(root);
    const controller = new AbortController();
    const provider = new FileSkillProvider(
      new Context(),
      { signal: controller.signal, invalidate: vi.fn() },
      {
        name: 'watch-close-test',
        roots: [{ path: root, source: 'project-agents', rank: 100 }],
      },
    );
    await provider.list({});
    await provider.dispose();

    const watcher = (
      provider as unknown as {
        watcher?: { emit(event: 'error', error: unknown): boolean };
      }
    ).watcher;
    expect(watcher?.emit('error', new Error('late watcher error'))).toBe(true);
  });

  it('loads fixed Matt Skills and enforces invocation policy at the command boundary', async () => {
    const { context, workspaceRoot } = await fixture();
    const catalog = await context.commandRouter.execute<
      { cwd: string; audience: 'model' },
      { complete: boolean; skills: Array<{ name: string }> }
    >('skill.list', { cwd: workspaceRoot, audience: 'model' });
    expect(catalog.complete).toBe(true);
    const names = catalog.skills.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(['codebase-design', 'pr', 'tdd']));
    expect(names).not.toContain('teach');
    expect(names).not.toContain('to-spec');
    expect(names).not.toContain('to-tickets');
    await expect(
      context.commandRouter.execute('skill.get', {
        cwd: workspaceRoot,
        audience: 'model',
        name: 'teach',
      }),
    ).rejects.toThrow('unavailable for model invocation');
    const teach = await context.commandRouter.execute<
      { cwd: string; audience: 'user'; name: string },
      { skill: { content: string } }
    >('skill.get', { cwd: workspaceRoot, audience: 'user', name: 'teach' });
    expect(teach.skill.content).toContain('.repoctopus/learning/<topic>/');
    await context.fiber.dispose();
  });

  it('lets a project skill replace the built-in tdd implementation without changing consumers', async () => {
    const { context, workspaceRoot } = await fixture();
    const directory = path.join(workspaceRoot, '.agents', 'skills', 'tdd');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: tdd\ndescription: Project TDD\n---\n\nProject-specific TDD.\n',
    );
    const result = await context.commandRouter.execute<
      { cwd: string; audience: 'user'; name: string },
      { skill: { provider: string; content: string } }
    >('skill.get', { cwd: workspaceRoot, audience: 'user', name: 'tdd' });
    expect(result.skill.provider).toBe('project-user-files');
    expect(result.skill.content).toBe('Project-specific TDD.');
    await context.fiber.dispose();
  });

  it('keeps a flat Skill out of sibling resources and reserves the owned Workspace entry for Hosts', async () => {
    const { context, workspaceRoot } = await fixture();
    const directory = path.join(workspaceRoot, '.agents', 'skills');
    const entry = path.join(directory, 'repoctopus');
    await mkdir(entry, { recursive: true });
    await writeFile(
      path.join(directory, 'flat.md'),
      '---\nname: flat\ndescription: Flat Skill\n---\n\nFlat body.\n',
    );
    await writeFile(
      path.join(directory, 'sibling.md'),
      '---\nname: sibling\ndescription: Sibling Skill\n---\n\nSibling body.\n',
    );
    await writeFile(
      path.join(entry, 'SKILL.md'),
      markWorkspaceEntrySkill(
        '---\nname: repoctopus\ndescription: Workspace entry\n---\n\nWorkspace entry body.\n',
      ),
    );
    const flat = await context.skills.get('flat', { cwd: workspaceRoot });
    expect(flat?.resourceBase).toBeUndefined();
    expect(await context.skills.get('repoctopus', { cwd: workspaceRoot })).toBeUndefined();
    await context.fiber.dispose();
  });

  it('refuses to capture resources reached through a link inside a Skill', async () => {
    const { context, workspaceRoot } = await fixture();
    const root = path.join(workspaceRoot, '.agents', 'skills', 'linked-reference');
    const external = await mkdtemp(path.join(tmpdir(), 'repoctopus-external-skill-resource-'));
    temporaryRoots.push(external);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, 'SKILL.md'),
      '---\nname: linked-reference\ndescription: Linked reference\n---\n\nReference body.\n',
    );
    await writeFile(path.join(external, 'reference.md'), 'Outside resource');
    await symlink(
      external,
      path.join(root, 'refs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    try {
      const definition = await context.skills.get('linked-reference', { cwd: workspaceRoot });
      expect(definition).toBeDefined();
      await expect(captureWorkSkill(definition!)).rejects.toThrow(
        'Unsafe Work Skill resource: refs',
      );
    } finally {
      await context.fiber.dispose();
    }
  });

  it('projects the same resolved catalog for Codex and OpenCode and refuses local edits', async () => {
    const { context, workspaceRoot } = await fixture();
    const codex = await context.commandRouter.execute<
      { cwd: string; target: 'codex' },
      { managedFiles: number; skills: Array<{ name: string; contentDigest: string }> }
    >('skill.project', { cwd: workspaceRoot, target: 'codex' });
    const opencode = await context.commandRouter.execute<
      { cwd: string; target: 'opencode' },
      { managedFiles: number; skills: Array<{ name: string; contentDigest: string }> }
    >('skill.project', { cwd: workspaceRoot, target: 'opencode' });
    expect(codex.managedFiles).toBeGreaterThan(0);
    expect(opencode.managedFiles).toBeGreaterThan(0);
    expect(codex.skills).toEqual(opencode.skills);
    expect(codex.skills.map((skill) => skill.name)).not.toEqual(
      expect.arrayContaining(['to-spec', 'to-tickets']),
    );

    const codexTdd = await readFile(
      path.join(workspaceRoot, '.agents', 'skills', 'tdd', 'SKILL.md'),
      'utf8',
    );
    const opencodeTdd = await readFile(
      path.join(workspaceRoot, '.opencode', 'skills', 'tdd', 'SKILL.md'),
      'utf8',
    );
    expect(codexTdd).toContain('name: tdd');
    expect(opencodeTdd).toContain('repoctopus/provider: matt-builtins');
    expect(await readFile(path.join(workspaceRoot, '.gitignore'), 'utf8')).toContain(
      '.repoctopus/',
    );

    await writeFile(
      path.join(workspaceRoot, '.opencode', 'skills', 'tdd', 'SKILL.md'),
      `${opencodeTdd}\nlocal edit\n`,
    );
    await expect(
      context.commandRouter.execute('skill.project', {
        cwd: workspaceRoot,
        target: 'opencode',
      }),
    ).rejects.toThrow('Managed Skill file has local edits');
    await context.fiber.dispose();
  });
});
