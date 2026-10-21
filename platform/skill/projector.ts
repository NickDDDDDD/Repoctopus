import { createHash } from 'node:crypto';
import { access, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { SkillDefinition } from '@deepseek-ai/dsh-skill';
import { stringify } from 'yaml';

import { atomicWriteBytes, atomicWriteJson, atomicWriteText } from '../filesystem/atomic-write.js';
import { ensureRepoctopusGitignore } from '../project-configuration/gitignore.js';

export type SkillProjectionTarget = 'codex' | 'opencode';

export interface ProjectedSkillInput {
  readonly definition: SkillDefinition;
  readonly contentDigest: `sha256:${string}`;
}

interface ManagedFile {
  path: string;
  sha256: string;
  skill: string;
}

interface ProjectionManifest {
  apiVersion: 'repoctopus.skill-projection/v1alpha1';
  kind: 'SkillProjection';
  target: SkillProjectionTarget;
  root: string;
  files: ManagedFile[];
  skills: Array<{
    name: string;
    provider: string;
    contentDigest: `sha256:${string}`;
    mode: 'managed' | 'native';
  }>;
}

export interface ProjectionResult {
  manifest: string;
  target: SkillProjectionTarget;
  root: string;
  managedFiles: number;
  skills: ProjectionManifest['skills'];
}

const MANAGED_MARKER = '.repoctopus-managed.json';

function digest(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function targetRoot(workspace: string, target: SkillProjectionTarget): string {
  return path.join(workspace, target === 'codex' ? '.agents/skills' : '.opencode/skills');
}

function manifestPath(workspace: string, target: SkillProjectionTarget): string {
  return path.join(workspace, '.repoctopus', 'skill-projections', `${target}.json`);
}

function skillMarkdown(definition: SkillDefinition, target: SkillProjectionTarget): string {
  const frontmatter: Record<string, unknown> = {
    name: definition.name,
    description: definition.description,
  };
  if (target === 'codex') {
    if (!definition.invocation.modelInvocable) frontmatter['disable-model-invocation'] = true;
    if (!definition.invocation.userInvocable) frontmatter['user-invocable'] = false;
  } else {
    frontmatter.metadata = {
      'repoctopus/provider': definition.provider,
      'repoctopus/content-digest': createHash('sha256').update(definition.content).digest('hex'),
      ...(definition.invocation.modelInvocable ? {} : { 'opencode/autoinvoke': 'false' }),
      ...(definition.invocation.userInvocable ? { 'opencode/slash': 'true' } : {}),
    };
  }
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${definition.content.trim()}\n`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(file: string): Promise<ProjectionManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as ProjectionManifest;
    if (
      value.apiVersion !== 'repoctopus.skill-projection/v1alpha1' ||
      value.kind !== 'SkillProjection' ||
      !Array.isArray(value.files) ||
      !Array.isArray(value.skills)
    ) {
      throw new Error(`Invalid Skill projection manifest: ${file}`);
    }
    return value;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function assertManagedFilesUnchanged(
  workspace: string,
  previous: ProjectionManifest | undefined,
): Promise<void> {
  for (const entry of previous?.files ?? []) {
    const file = path.resolve(workspace, entry.path);
    if (!isInside(workspace, file))
      throw new Error(`Managed Skill path escapes workspace: ${entry.path}`);
    if (!(await exists(file))) continue;
    if (digest(await readFile(file)) !== entry.sha256) {
      throw new Error(`Managed Skill file has local edits: ${entry.path}`);
    }
  }
}

async function resourceFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await resourceFiles(absolute, relative)));
    else if (entry.isFile() && relative !== 'SKILL.md') files.push(relative);
  }
  return files.sort();
}

export async function projectSkills(input: {
  workspace: string;
  target: SkillProjectionTarget;
  skills: readonly ProjectedSkillInput[];
}): Promise<ProjectionResult> {
  const workspace = path.resolve(input.workspace);
  await ensureRepoctopusGitignore(workspace);
  const root = targetRoot(workspace, input.target);
  const manifestFile = manifestPath(workspace, input.target);
  const previous = await readManifest(manifestFile);
  if (previous && previous.target !== input.target) {
    throw new Error(`Skill projection manifest target mismatch: ${manifestFile}`);
  }
  await assertManagedFilesUnchanged(workspace, previous);

  const previousFiles = new Map((previous?.files ?? []).map((entry) => [entry.path, entry]));
  const outputs = new Map<string, { contents: string | Uint8Array; skill: string }>();
  const skills: ProjectionManifest['skills'] = [];

  for (const item of [...input.skills].sort((left, right) =>
    left.definition.name.localeCompare(right.definition.name),
  )) {
    const definition = item.definition;
    const native =
      definition.source === 'project-agents' ||
      definition.source === 'user-agents' ||
      (definition.path ? isInside(root, path.resolve(definition.path)) : false);
    skills.push({
      name: definition.name,
      provider: definition.provider,
      contentDigest: item.contentDigest,
      mode: native ? 'native' : 'managed',
    });
    if (native) continue;
    const skillRoot = path.join(root, definition.name);
    outputs.set(path.join(skillRoot, 'SKILL.md'), {
      contents: skillMarkdown(definition, input.target),
      skill: definition.name,
    });
    outputs.set(path.join(skillRoot, MANAGED_MARKER), {
      contents: `${JSON.stringify(
        {
          apiVersion: 'repoctopus.skill-projection/v1alpha1',
          name: definition.name,
          provider: definition.provider,
          contentDigest: item.contentDigest,
        },
        null,
        2,
      )}\n`,
      skill: definition.name,
    });
    if (definition.resourceBase?.kind === 'directory') {
      for (const relative of await resourceFiles(definition.resourceBase.path)) {
        outputs.set(path.join(skillRoot, ...relative.split('/')), {
          contents: await readFile(path.join(definition.resourceBase.path, relative)),
          skill: definition.name,
        });
      }
    }
  }

  for (const file of outputs.keys()) {
    const relative = path.relative(workspace, file).replaceAll('\\', '/');
    if (!previousFiles.has(relative) && (await exists(file))) {
      throw new Error(`Skill projection would overwrite an unmanaged file: ${relative}`);
    }
  }

  const managedFiles: ManagedFile[] = [];
  for (const [file, output] of [...outputs].sort(([left], [right]) => left.localeCompare(right))) {
    if (typeof output.contents === 'string') {
      await atomicWriteText(file, output.contents, { containedRoot: workspace });
    } else {
      await atomicWriteBytes(file, output.contents, { containedRoot: workspace });
    }
    managedFiles.push({
      path: path.relative(workspace, file).replaceAll('\\', '/'),
      sha256: digest(output.contents),
      skill: output.skill,
    });
  }

  const current = new Set(managedFiles.map((entry) => entry.path));
  for (const stale of previous?.files ?? []) {
    if (current.has(stale.path)) continue;
    await rm(path.resolve(workspace, stale.path), { force: true });
  }

  const manifest: ProjectionManifest = {
    apiVersion: 'repoctopus.skill-projection/v1alpha1',
    kind: 'SkillProjection',
    target: input.target,
    root: path.relative(workspace, root).replaceAll('\\', '/'),
    files: managedFiles,
    skills,
  };
  await atomicWriteJson(manifestFile, manifest, { containedRoot: workspace });
  return {
    manifest: path.relative(workspace, manifestFile).replaceAll('\\', '/'),
    target: input.target,
    root: manifest.root,
    managedFiles: managedFiles.length,
    skills,
  };
}
