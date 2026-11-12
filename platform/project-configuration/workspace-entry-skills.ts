import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  isOwnedWorkspaceEntrySkill,
  markWorkspaceEntrySkill,
  workspaceEntryDigest as digest,
  WORKSPACE_ENTRY_HOSTS,
  type WorkspaceEntryHost,
  type WorkspaceEntrySkillPlan,
} from '../../domains/project-configuration/entry-skills.js';
import { atomicWriteText, prepareContainedFileCleanup } from '../filesystem/atomic-write.js';

const productRoot = path.resolve(
  import.meta.dirname,
  ...(path.basename(import.meta.dirname) === 'dist' ? ['..'] : ['..', '..']),
);
type EntrySkill = 'repoctopus' | 'repoctopus-init' | 'repoctopus-configure-verify';
type EntryTarget = { host: WorkspaceEntryHost; path: string; skill: EntrySkill };

function workspaceTargets(): EntryTarget[] {
  return WORKSPACE_ENTRY_HOSTS.flatMap((host) => {
    const directory = host === 'codex' ? '.agents' : '.opencode';
    return (['repoctopus', 'repoctopus-configure-verify'] as const).map((skill) => ({
      host,
      skill,
      path: `${directory}/skills/${skill}/SKILL.md`,
    }));
  });
}

function selectedHosts(hosts: readonly string[]): readonly WorkspaceEntryHost[] {
  if (
    !hosts.length ||
    hosts.some((host) => !WORKSPACE_ENTRY_HOSTS.some((known) => known === host))
  ) {
    throw new Error('Entry hosts must be codex or opencode');
  }
  return WORKSPACE_ENTRY_HOSTS.filter((host) => hosts.includes(host));
}

async function desiredEntry(skill: EntrySkill): Promise<string> {
  const asset = path.join(productRoot, 'skills', 'entry', skill, 'SKILL.md');
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
  const chosen = selectedHosts(hosts);
  return planEntryTargets(
    workspace,
    workspaceTargets().filter(({ host }) => chosen.includes(host)),
  );
}

async function planEntryTargets(
  root: string,
  targets: readonly EntryTarget[],
): Promise<WorkspaceEntrySkillPlan[]> {
  return Promise.all(
    targets.map(async ({ host, path: file, skill }) => {
      const contentDigest = digest(await desiredEntry(skill));
      try {
        const observed = await observe(root, file);
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
  return prepareEntryWrites(workspace, workspaceTargets(), plans, resuming, requestId, afterWrite);
}

async function prepareEntryWrites(
  workspace: string,
  targets: readonly EntryTarget[],
  plans: readonly WorkspaceEntrySkillPlan[],
  resuming: boolean,
  requestId: string,
  afterWrite?: (file: string) => Promise<void> | void,
) {
  const stagingTag = digest(requestId).slice(0, 24);
  const writes = await Promise.all(
    plans.map(async (plan) => {
      const target = targets.find(
        ({ host, path: file }) => host === plan.host && file === plan.path,
      );
      const desired = target ? await desiredEntry(target.skill) : null;
      if (desired === null || plan.contentDigest !== digest(desired)) {
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
        desired,
        cleanup: await Promise.all(
          leftovers
            .filter((entry) => entry.isFile() && stagingName(stagingTag).test(entry.name))
            .map(({ name }) => prepareContainedFileCleanup(path.join(directory, name), workspace)),
        ),
      };
    }),
  );
  return {
    async install() {
      for (const { plan, current, desired, cleanup } of writes) {
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
        for (const remove of cleanup) await remove();
      }
    },
    async verify() {
      for (const { plan, desired } of writes) {
        if ((await observe(workspace, plan.path, stagingTag))?.text !== desired) {
          throw new Error(`Workspace entry was not materialized: ${plan.path}`);
        }
      }
    },
  };
}

export async function installPersonalInitSkills(hosts: readonly string[], preview: boolean) {
  const root = await realpath(homedir());
  const targets = selectedHosts(hosts).map((host): EntryTarget => {
    const directory =
      host === 'codex'
        ? process.env.CODEX_HOME || path.join(root, '.codex')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(root, '.config'), 'opencode');
    const relative = path.relative(root, path.resolve(directory));
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Personal ${host} Skill directory must be inside the user's home: ${directory}`,
      );
    }
    const skill = 'repoctopus-init';
    return {
      host,
      skill,
      path: path.join(relative, 'skills', skill, 'SKILL.md').replaceAll('\\', '/'),
    };
  });
  const plans = await planEntryTargets(root, targets);
  if (!preview) {
    const writes = await prepareEntryWrites(root, targets, plans, false, 'personal-init');
    await writes.install();
    await writes.verify();
  }
  return { preview, targets: plans.map((plan) => ({ ...plan, path: path.join(root, plan.path) })) };
}
