import { lstat, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  isOwnedWorkspaceEntrySkill,
  markWorkspaceEntrySkill,
  workspaceEntryDigest as digest,
  WORKSPACE_ENTRY_HOSTS,
  type WorkspaceEntryHost,
  type WorkspaceEntrySkillPlan,
} from '../../domains/project-configuration/entry-skills.js';
import { atomicWriteText } from '../filesystem/atomic-write.js';

const productRoot = path.resolve(
  import.meta.dirname,
  ...(path.basename(import.meta.dirname) === 'dist' ? ['..'] : ['..', '..']),
);
const asset = path.join(productRoot, 'skills', 'entry', 'repoctopus', 'SKILL.md');

function target(host: WorkspaceEntryHost): string {
  return `${host === 'codex' ? '.agents' : '.opencode'}/skills/repoctopus/SKILL.md`;
}

async function desiredEntry(): Promise<string> {
  const body = (await readFile(asset, 'utf8')).replaceAll('\r\n', '\n').trimEnd() + '\n';
  return markWorkspaceEntrySkill(body);
}

class EntryConflict extends Error {}

function stagingName(tag: string): RegExp {
  return new RegExp(`^\\.SKILL\\.md\\.${tag}\\.[a-f0-9]{12}\\.tmp$`, 'u');
}

async function observe(
  workspace: string,
  file: string,
  stagingTag?: string,
): Promise<{ text: string; identity: string } | null> {
  const targetFile = path.join(workspace, file);
  let cursor = workspace;
  try {
    for (const part of file.split('/')) {
      cursor = path.join(cursor, part);
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || (cursor === targetFile ? !stat.isFile() : !stat.isDirectory())) {
        throw new EntryConflict(`Workspace entry needs a regular contained path: ${file}`);
      }
      if (cursor === path.dirname(targetFile)) {
        const files = await readdir(cursor, { withFileTypes: true });
        const staging = stagingTag && stagingName(stagingTag);
        if (
          files.some(
            (file) =>
              file.name !== 'SKILL.md' && !(file.isFile() && staging && staging.test(file.name)),
          )
        ) {
          throw new EntryConflict(`Workspace entry directory contains unmanaged files: ${file}`);
        }
      }
    }
    const identity = async () => {
      const stat = await lstat(targetFile, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new EntryConflict(`Unsafe Workspace entry: ${file}`);
      return [stat.dev, stat.ino, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs, stat.size].join(
        ':',
      );
    };
    const before = await identity();
    const bytes = await readFile(targetFile);
    if (before !== (await identity()))
      throw new EntryConflict(`Workspace entry changed while reading: ${file}`);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(bytes)
        .replaceAll('\r\n', '\n');
    } catch {
      throw new EntryConflict(`Workspace entry is not valid UTF-8: ${file}`);
    }
    if (!isOwnedWorkspaceEntrySkill(text)) {
      throw new EntryConflict(
        `Workspace entry is unmanaged or locally modified: ${file}. Move it aside before preparing a new request.`,
      );
    }
    return { text, identity: before };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function planWorkspaceEntrySkills(
  workspace: string,
  hosts: readonly string[] = WORKSPACE_ENTRY_HOSTS,
): Promise<WorkspaceEntrySkillPlan[]> {
  if (
    hosts.length === 0 ||
    hosts.some((host) => !WORKSPACE_ENTRY_HOSTS.some((item) => item === host))
  ) {
    throw new Error('Workspace entry hosts must be codex or opencode');
  }
  const contentDigest = digest(await desiredEntry());
  return Promise.all(
    WORKSPACE_ENTRY_HOSTS.filter((host) => hosts.includes(host)).map(async (host) => {
      const file = target(host);
      try {
        const observed = await observe(workspace, file);
        const beforeDigest = observed ? digest(observed.text) : null;
        return {
          host,
          path: file,
          beforeDigest,
          contentDigest,
          status:
            beforeDigest === null ? 'create' : beforeDigest === contentDigest ? 'keep' : 'update',
        };
      } catch (error) {
        if (!(error instanceof EntryConflict)) throw error;
        return {
          host,
          path: file,
          beforeDigest: null,
          contentDigest,
          status: 'conflict',
          diagnostic: error.message,
        };
      }
    }),
  );
}

export async function prepareWorkspaceEntryWrites(
  workspace: string,
  plans: readonly WorkspaceEntrySkillPlan[],
  resuming: boolean,
  requestId: string,
  afterWrite?: (file: string) => Promise<void> | void,
): Promise<{ install(): Promise<void>; verify(): Promise<void> }> {
  const stagingTag = digest(requestId).slice(0, 24);
  const desired = plans.length ? await desiredEntry() : '';
  const contentDigest = digest(desired);
  const writes = await Promise.all(
    plans.map(async (plan) => {
      if (
        !WORKSPACE_ENTRY_HOSTS.includes(plan.host) ||
        target(plan.host) !== plan.path ||
        plan.contentDigest !== contentDigest
      ) {
        throw new Error('Workspace entry plan changed. Prepare a new approval request.');
      }
      if (plan.status === 'conflict')
        throw new Error(plan.diagnostic ?? `Workspace entry conflict: ${plan.path}`);
      const current = await observe(workspace, plan.path, resuming ? stagingTag : undefined);
      const currentDigest = current ? digest(current.text) : null;
      if (
        currentDigest !== plan.beforeDigest &&
        !(resuming && currentDigest === plan.contentDigest)
      ) {
        throw new Error(`Workspace entry changed since approval was prepared: ${plan.path}`);
      }
      const directory = path.dirname(path.join(workspace, plan.path));
      const leftovers = resuming
        ? await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
          })
        : [];
      return {
        plan,
        current,
        directory,
        leftovers: leftovers.filter(
          (entry) => entry.isFile() && stagingName(stagingTag).test(entry.name),
        ),
      };
    }),
  );
  return {
    async install() {
      for (const { plan, current, directory, leftovers } of writes) {
        if (current?.text !== desired) {
          await atomicWriteText(path.join(workspace, plan.path), desired, {
            containedRoot: workspace,
            exclusive: current === null,
            temporaryTag: stagingTag,
            beforeCommit: async () => {
              const latest = await observe(workspace, plan.path, stagingTag);
              if (latest?.text !== current?.text || latest?.identity !== current?.identity) {
                throw new Error(`Workspace entry changed before write: ${plan.path}`);
              }
            },
          });
          await afterWrite?.(plan.path);
        }
        if (!leftovers.length) continue;
        if (
          (await observe(workspace, plan.path, stagingTag))?.text !== desired ||
          path.relative(directory, await realpath(directory))
        ) {
          throw new Error(`Workspace entry changed while recovering staging files: ${plan.path}`);
        }
        for (const entry of leftovers) {
          const file = path.join(directory, entry.name);
          try {
            if ((await lstat(file)).isFile()) await unlink(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
    },
    async verify() {
      for (const { plan } of writes) {
        if ((await observe(workspace, plan.path, stagingTag))?.text !== desired) {
          throw new Error(`Workspace entry was not materialized: ${plan.path}`);
        }
      }
    },
  };
}
