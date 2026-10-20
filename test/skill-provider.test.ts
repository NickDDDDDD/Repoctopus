import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import { afterEach, describe, expect, it } from 'vitest';

import skillCatalogContributor from '../plugins/command/skill-catalog-contributor.js';
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
  it('loads fixed Matt Skills and enforces invocation policy at the command boundary', async () => {
    const { context, workspaceRoot } = await fixture();
    const catalog = await context.commandRouter.execute<
      { cwd: string; audience: 'model' },
      { complete: boolean; skills: Array<{ name: string }> }
    >('skill.list', { cwd: workspaceRoot, audience: 'model' });
    expect(catalog.complete).toBe(true);
    expect(catalog.skills.map((skill) => skill.name)).toContain('tdd');
    expect(catalog.skills.map((skill) => skill.name)).not.toContain('teach');
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
