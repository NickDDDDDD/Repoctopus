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

import {
  planWorkflowSkill,
  prepareWorkflowSkill,
  workflowSkillTargets,
  type WorkflowSkillTarget,
} from './workspace-workflow-skills.js';

const productRoot = path.resolve(
  import.meta.dirname,
  ...(path.basename(import.meta.dirname) === 'dist' ? ['..'] : ['..', '..']),
);
type EntrySkill = 'repoctopus' | 'repoctopus-init' | 'repoctopus-configure-verify';
type EntryTarget = { host: WorkspaceEntryHost; path: string; skill: EntrySkill };
const DEFAULT_WORKSPACE_ENTRY_HOSTS = ['codex', 'opencode'] as const;
const HOST_DIRECTORIES: Record<WorkspaceEntryHost, { workspace: string; personal: string }> = {
  codex: { workspace: '.agents', personal: '.codex' },
  opencode: { workspace: '.opencode', personal: '.config/opencode' },
  codebuddy: { workspace: '.codebuddy', personal: '.codebuddy' },
  codearts: { workspace: '.codeartsdoer', personal: '.codeartsdoer' },
  trae: { workspace: '.trae', personal: '.trae' },
  'trae-cn': { workspace: '.trae', personal: '.trae-cn' },
};

function workspaceTargets(): EntryTarget[] {
  return WORKSPACE_ENTRY_HOSTS.flatMap((host) => {
    const directory = HOST_DIRECTORIES[host].workspace;
    return (['repoctopus', 'repoctopus-configure-verify'] as const).map((skill) => ({
      host,
      skill,
      path: `${directory}/skills/${skill}/SKILL.md`,
    }));
  });
}

export function workspaceSkillPath(host: WorkspaceEntryHost, name: string): string {
  return `${HOST_DIRECTORIES[host].workspace}/skills/${name}/SKILL.md`;
}

function workflowTargets(hosts: readonly WorkspaceEntryHost[], openSpec: boolean) {
  const targets = hosts.flatMap((host) =>
    workflowSkillTargets(productRoot, host, HOST_DIRECTORIES[host].workspace, openSpec),
  );
  return uniqueEntryTargets(targets);
}

function selectedHosts(hosts: readonly string[]): readonly WorkspaceEntryHost[] {
  if (
    !hosts.length ||
    hosts.some((host) => !WORKSPACE_ENTRY_HOSTS.some((known) => known === host))
  ) {
    throw new Error(`Entry hosts must be one or more of: ${WORKSPACE_ENTRY_HOSTS.join(', ')}`);
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
  hosts: readonly string[] = DEFAULT_WORKSPACE_ENTRY_HOSTS,
  openSpec = true,
): Promise<WorkspaceEntrySkillPlan[]> {
  const chosen = selectedHosts(hosts);
  const [entries, workflow] = await Promise.all([
    planEntryTargets(
      workspace,
      uniqueEntryTargets(workspaceTargets().filter(({ host }) => chosen.includes(host))),
    ),
    Promise.all(
      workflowTargets(chosen, openSpec).map((target) => planWorkflowSkill(workspace, target)),
    ),
  ]);
  return [...entries, ...workflow];
}

function entryPathKey(file: string): string {
  return process.platform === 'win32' ? file.toLowerCase() : file;
}

function uniqueEntryTargets<T extends EntryTarget | WorkflowSkillTarget>(
  targets: readonly T[],
): T[] {
  const unique = new Map<string, T>();
  for (const target of targets) {
    const key = entryPathKey(target.path);
    if (!unique.has(key)) unique.set(key, target);
  }
  return [...unique.values()];
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
  checkScope?: () => Promise<void>,
  openSpec = true,
): Promise<{ install(): Promise<void>; verify(): Promise<void> }> {
  if (new Set(plans.map(({ path: file }) => entryPathKey(file))).size !== plans.length) {
    throw new Error('Workspace Skill plan contains duplicate target paths');
  }
  const entries = await prepareEntryWrites(
    workspace,
    workspaceTargets(),
    plans.filter(({ files }) => files === undefined),
    resuming,
    requestId,
    afterWrite,
    checkScope,
  );
  const available = WORKSPACE_ENTRY_HOSTS.flatMap((host) => workflowTargets([host], openSpec));
  const workflow = await Promise.all(
    plans
      .filter(({ files }) => files !== undefined)
      .map((plan) => {
        const target = available.find(
          ({ host, path: file }) => host === plan.host && file === plan.path,
        );
        if (!target) throw new Error(`Unknown Workspace Skill target: ${plan.path}`);
        return prepareWorkflowSkill(
          workspace,
          target,
          plan,
          resuming,
          digest(requestId).slice(0, 24),
          checkScope,
        );
      }),
  );
  return {
    async install() {
      await entries.install();
      for (const entry of workflow) await entry.install(afterWrite);
    },
    async verify() {
      for (const entry of workflow) await entry.verify();
      await entries.verify();
    },
  };
}

async function prepareEntryWrites(
  workspace: string,
  targets: readonly EntryTarget[],
  plans: readonly WorkspaceEntrySkillPlan[],
  resuming: boolean,
  requestId: string,
  afterWrite?: (file: string) => Promise<void> | void,
  checkScope?: () => Promise<void>,
) {
  if (new Set(plans.map(({ path }) => entryPathKey(path))).size !== plans.length) {
    throw new Error('Entry Skill plan contains duplicate target paths');
  }
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
              await checkScope?.();
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
  const targets = uniqueEntryTargets(
    selectedHosts(hosts).map((host): EntryTarget => {
      const defaultDirectory = path.join(root, HOST_DIRECTORIES[host].personal);
      const directory =
        host === 'codex' && process.env.CODEX_HOME
          ? process.env.CODEX_HOME
          : host === 'opencode' && process.env.XDG_CONFIG_HOME
            ? path.join(process.env.XDG_CONFIG_HOME, 'opencode')
            : host === 'codebuddy' && process.env.CODEBUDDY_CONFIG_DIR
              ? process.env.CODEBUDDY_CONFIG_DIR
              : defaultDirectory;
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
    }),
  );
  const plans = await planEntryTargets(root, targets);
  if (!preview) {
    const writes = await prepareEntryWrites(root, targets, plans, false, 'personal-init');
    await writes.install();
    await writes.verify();
  }
  return { preview, targets: plans.map((plan) => ({ ...plan, path: path.join(root, plan.path) })) };
}
