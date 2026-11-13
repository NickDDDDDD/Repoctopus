import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { BUILTIN_WORKFLOW_SKILL_NAMES } from '../../domains/skill/builtin-workflow-skills.js';
import {
  workspaceEntryDigest as digest,
  workspaceWorkflowSkillManifestPath,
  WORKSPACE_WORKFLOW_SKILL_MARKER,
  type WorkspaceEntrySkillPlan,
  type WorkspaceEntryHost,
} from '../../domains/project-configuration/entry-skills.js';
import { atomicWriteBytes, prepareContainedFileCleanup } from '../filesystem/atomic-write.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';

const MAX_SKILL_FILE_BYTES = 1024 * 1024;

export interface WorkflowSkillTarget {
  host: WorkspaceEntryHost;
  path: string;
  asset: string;
}

export function workflowSkillTargets(
  productRoot: string,
  host: WorkspaceEntryHost,
  directory: string,
  openSpec: boolean,
): WorkflowSkillTarget[] {
  return [
    ...BUILTIN_WORKFLOW_SKILL_NAMES.map((name) => ({
      name,
      asset: name.startsWith('repoctopus-')
        ? path.join(productRoot, 'skills/lifecycle', name)
        : path.join(
            productRoot,
            'third_party/matt-skills/skills',
            name === 'grilling' ? 'productivity' : 'engineering',
            name,
          ),
    })),
    ...(openSpec
      ? [
          {
            name: 'openspec-explore',
            asset: path.join(productRoot, 'skills/specification/openspec-explore'),
          },
        ]
      : []),
  ].map(({ name, asset }) => ({ host, path: `${directory}/skills/${name}/SKILL.md`, asset }));
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
  const directory = path.join(root, relative);
  try {
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      path.relative(directory, await realpath(directory))
    ) {
      throw new Error(`Unsafe Skill directory: ${directory}`);
    }
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsafe Skill file: ${child}`);
  }
  return files.sort();
}

export async function readExactSkillFile(file: string): Promise<Buffer> {
  const { bytes } = await readFileRaceSafe(file, MAX_SKILL_FILE_BYTES, {
    bigint: true,
    verify: (_stage, { realPath }) => {
      if (path.relative(file, realPath)) throw new Error(`Unsafe Skill file: ${file}`);
    },
  });
  return bytes;
}

/** Compare text consistently across Git checkouts; binary resources retain their bytes. */
export function normalizeSkillFile(bytes: Buffer): Buffer {
  const text = bytes.toString('utf8');
  if (!text.includes('\0') && Buffer.from(text).equals(bytes)) {
    return Buffer.from(text.replaceAll('\r\n', '\n'));
  }
  return bytes;
}

async function observe(file: string): Promise<string | null> {
  try {
    return digest(normalizeSkillFile(await readExactSkillFile(file)));
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function desired(target: WorkflowSkillTarget) {
  const contents = new Map<string, Buffer>();
  for (const file of await listFiles(target.asset)) {
    const bytes = normalizeSkillFile(await readExactSkillFile(path.join(target.asset, file)));
    if (file === 'SKILL.md') {
      const markdown = bytes.toString('utf8').replace(/^\uFEFF/u, '');
      if (!markdown.startsWith('---\n')) throw new Error(`Invalid packaged Skill: ${target.path}`);
      contents.set(
        file,
        Buffer.from(markdown.replace('---\n', `---\n${WORKSPACE_WORKFLOW_SKILL_MARKER}\n`)),
      );
    } else {
      contents.set(file, bytes);
    }
  }
  if (!contents.has('SKILL.md')) throw new Error(`Packaged Skill is missing: ${target.path}`);
  const manifest = Buffer.from(
    JSON.stringify(Object.fromEntries([...contents].map(([file, bytes]) => [file, digest(bytes)]))),
  );
  return { contents, manifest };
}

function temporaryFile(file: string, tag?: string): boolean {
  return Boolean(
    tag &&
    file
      .split('/')
      .at(-1)
      ?.match(new RegExp(`^\\..+\\.${tag}\\.[a-f0-9]{12}\\.tmp$`, 'u')),
  );
}

function skillPaths(workspace: string, target: WorkflowSkillTarget) {
  return {
    directory: path.dirname(path.join(workspace, target.path)),
    manifest: path.join(workspace, workspaceWorkflowSkillManifestPath(target.path)),
  };
}

async function readManifest(file: string): Promise<Record<string, string> | null> {
  try {
    const entries: unknown = JSON.parse((await readExactSkillFile(file)).toString('utf8'));
    if (
      !entries ||
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      !Object.hasOwn(entries, 'SKILL.md') ||
      Object.entries(entries).some(
        ([name, hash]) =>
          !name
            .split('/')
            .every((part) => /^[a-zA-Z0-9_.-]+$/u.test(part) && part !== '..' && part !== '.') ||
          typeof hash !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(hash),
      )
    )
      throw new Error(`Invalid managed Skill manifest: ${file}`);
    return entries as Record<string, string>;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export async function planWorkflowSkill(
  workspace: string,
  target: WorkflowSkillTarget,
): Promise<WorkspaceEntrySkillPlan> {
  const { contents, manifest } = await desired(target);
  const paths = skillPaths(workspace, target);
  const contentDigest = digest(manifest);
  try {
    await listFiles(path.dirname(paths.manifest));
    const existing = await readManifest(paths.manifest);
    const files = new Set([
      ...(await listFiles(paths.directory)),
      ...contents.keys(),
      ...Object.keys(existing ?? {}),
    ]);
    const resources = await Promise.all(
      [...files].sort().map(async (file) => {
        const beforeDigest = await observe(path.join(paths.directory, file));
        if (beforeDigest !== null && beforeDigest !== existing?.[file]) {
          throw new Error(
            `Workspace Skill is unmanaged or locally modified: ${path.join(paths.directory, file)}`,
          );
        }
        const next = contents.get(file);
        return { path: file, beforeDigest, contentDigest: next ? digest(next) : null };
      }),
    );
    const beforeDigest = await observe(paths.manifest);
    return {
      host: target.host,
      path: target.path,
      beforeDigest,
      contentDigest,
      files: resources,
      status:
        beforeDigest === null
          ? 'create'
          : beforeDigest === contentDigest &&
              resources.every((file) => file.beforeDigest === file.contentDigest)
            ? 'keep'
            : 'update',
    };
  } catch (error) {
    return {
      host: target.host,
      path: target.path,
      beforeDigest: null,
      contentDigest,
      status: 'conflict',
      files: [],
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function prepareWorkflowSkill(
  workspace: string,
  target: WorkflowSkillTarget,
  plan: WorkspaceEntrySkillPlan,
  resuming: boolean,
  tag: string,
  checkScope?: () => Promise<void>,
) {
  const paths = skillPaths(workspace, target);
  const { contents, manifest } = await desired(target);
  const files = plan.files!;
  if (plan.status === 'conflict')
    throw new Error(plan.diagnostic ?? `Workspace Skill conflict: ${plan.path}`);
  const keys = new Set(
    files.map(({ path: file }) => (process.platform === 'win32' ? file.toLowerCase() : file)),
  );
  await listFiles(path.dirname(paths.manifest));
  const previous = await readManifest(paths.manifest);
  const previousDigest = await observe(paths.manifest);
  const alreadyCommitted = resuming && previousDigest === plan.contentDigest;
  if (
    plan.contentDigest !== digest(manifest) ||
    keys.size !== files.length ||
    (!alreadyCommitted && previousDigest !== plan.beforeDigest) ||
    [...contents].some(
      ([file, bytes]) =>
        !files.some((entry) => entry.path === file && entry.contentDigest === digest(bytes)),
    ) ||
    files.some(
      (entry) =>
        !contents.has(entry.path) &&
        (entry.contentDigest !== null ||
          (!alreadyCommitted && !Object.hasOwn(previous ?? {}, entry.path))),
    )
  )
    throw new Error(`Workspace Skill plan changed: ${plan.path}`);
  const leftovers = (await listFiles(paths.directory)).filter(
    (file) => resuming && temporaryFile(file, tag),
  );
  const assertFiles = async () => {
    const unexpected = (await listFiles(paths.directory)).find(
      (file) => !files.some((entry) => entry.path === file) && !temporaryFile(file, tag),
    );
    if (unexpected)
      throw new Error(`Workspace Skill contains an unmanaged file: ${plan.path}/${unexpected}`);
  };
  await assertFiles();
  const writes = await Promise.all(
    files.map(async (entry) => {
      const file = path.join(paths.directory, entry.path);
      const current = await observe(file);
      if (
        (current !== null &&
          !alreadyCommitted &&
          current !== previous?.[entry.path] &&
          !(resuming && current === entry.contentDigest)) ||
        (current !== entry.beforeDigest && !(resuming && current === entry.contentDigest))
      )
        throw new Error(`Workspace Skill changed since approval: ${file}`);
      return {
        entry,
        file,
        current,
        next: contents.get(entry.path),
        cleanup:
          current !== null && entry.contentDigest === null
            ? await prepareContainedFileCleanup(file, workspace)
            : undefined,
      };
    }),
  );
  const manifestDirectory = path.dirname(paths.manifest);
  const manifestTemporaryPrefix = `.${path.basename(paths.manifest)}.${tag}.`;
  const manifestStaging = resuming
    ? (await listFiles(manifestDirectory)).filter(
        (file) => file.startsWith(manifestTemporaryPrefix) && temporaryFile(file, tag),
      )
    : [];
  const cleanManifestStaging = await Promise.all(
    manifestStaging.map((file) =>
      prepareContainedFileCleanup(path.join(manifestDirectory, file), workspace),
    ),
  );
  const cleanStaging = await Promise.all(
    leftovers.map((file) =>
      prepareContainedFileCleanup(path.join(paths.directory, file), workspace),
    ),
  );
  const write = async (file: string, bytes: Buffer, current: string | null) => {
    await atomicWriteBytes(file, bytes, {
      containedRoot: workspace,
      exclusive: current === null,
      temporaryTag: tag,
      beforeCommit: async () => {
        await checkScope?.();
        await assertFiles();
        if ((await observe(file)) !== current)
          throw new Error(`Workspace Skill changed before write: ${file}`);
      },
    });
  };
  return {
    async install(afterWrite?: (file: string) => Promise<void> | void) {
      for (const { entry, file, current, next, cleanup } of writes) {
        if (current === entry.contentDigest) continue;
        if (next) await write(file, next, current);
        else {
          await checkScope?.();
          await cleanup?.();
        }
        await afterWrite?.(path.relative(workspace, file).replaceAll('\\', '/'));
      }
      for (const cleanup of [...cleanStaging, ...cleanManifestStaging]) await cleanup();
      if (previousDigest !== plan.contentDigest)
        await write(paths.manifest, manifest, previousDigest);
    },
    async verify() {
      await assertFiles();
      if (
        (await observe(paths.manifest)) !== plan.contentDigest ||
        (
          await Promise.all(
            files.map(
              async (file) =>
                (await observe(path.join(paths.directory, file.path))) !== file.contentDigest,
            ),
          )
        ).some(Boolean)
      )
        throw new Error(`Workspace Skill was not materialized: ${plan.path}`);
    },
  };
}

export async function installedSkillFiles(directory: string): Promise<string[]> {
  return listFiles(directory);
}
