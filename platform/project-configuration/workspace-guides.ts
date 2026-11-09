import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  renderWorkspaceGuides,
  type WorkspaceGuide,
} from '../../domains/project-configuration/workspace-guides.js';
import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import { atomicWriteText } from '../filesystem/atomic-write.js';

interface GuideWrite extends WorkspaceGuide {
  before: string | null;
  identity: string | null;
  after: string;
}

async function source(
  workspace: string,
  file: string,
): Promise<{ text: string; identity: string } | null> {
  const target = path.join(workspace, file);
  const parts = file.split('/');
  let cursor = workspace;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || (cursor === target ? !stat.isFile() : !stat.isDirectory())) {
        throw new Error(`Workspace guide requires a regular contained path: ${file}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  const before = await lstat(target, { bigint: true });
  const identity = (stat: typeof before) =>
    [stat.dev, stat.ino, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs, stat.size].join(':');
  const bytes = await readFile(target);
  const after = await lstat(target, { bigint: true });
  if (after.isSymbolicLink() || !after.isFile() || identity(before) !== identity(after)) {
    throw new Error(`Workspace guide changed while reading: ${file}`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`Workspace guide must use valid UTF-8: ${file}`);
  }
  return { text, identity: identity(after) };
}

export function mergeWorkspaceGuide(before: string | null, guide: WorkspaceGuide): string {
  const ending = before?.includes('\r\n') ? '\r\n' : '\n';
  const block = `<${guide.tag}>${ending}<!-- Managed by Repoctopus. Keep team content outside this block. -->${ending}${guide.content.replaceAll('\n', ending)}${ending}</${guide.tag}>`;
  const original = before ?? '';
  let start: number | null = null;
  let end: number | null = null;
  let cursor = 0;
  for (const line of original.split('\n')) {
    const marker = line.trim();
    if (
      new RegExp(`^</?${guide.tag}(?=[\\s/>]|$)`, 'u').test(marker) &&
      marker !== `<${guide.tag}>` &&
      marker !== `</${guide.tag}>`
    )
      throw new Error(`Malformed managed block marker: ${guide.file}`);
    if (line.trim() === `<${guide.tag}>`) {
      if (start !== null) throw new Error(`Duplicate or nested managed block: ${guide.file}`);
      start = cursor + (cursor === 0 && line.startsWith('\uFEFF') ? 1 : 0);
    } else if (line.trim() === `</${guide.tag}>`) {
      if (start === null || end !== null) throw new Error(`Malformed managed block: ${guide.file}`);
      end = cursor + line.replace(/\r$/u, '').length;
    }
    cursor += line.length + 1;
  }
  if (start !== null && end === null) throw new Error(`Incomplete managed block: ${guide.file}`);
  if (start !== null && end !== null) {
    return original.slice(0, start) + block + original.slice(end);
  }
  return original + (original && !original.endsWith('\n') ? ending : '') + block + ending;
}

export async function planWorkspaceGuides(
  workspace: string,
  config: SharedProjectConfig,
): Promise<GuideWrite[]> {
  return Promise.all(
    renderWorkspaceGuides(config).map(async (guide) => {
      const observed = await source(workspace, guide.file);
      const before = observed?.text ?? null;
      return {
        ...guide,
        before,
        identity: observed?.identity ?? null,
        after: mergeWorkspaceGuide(before, guide),
      };
    }),
  );
}

export async function installWorkspaceGuides(
  workspace: string,
  writes: readonly GuideWrite[],
  afterWrite?: (file: string) => Promise<void> | void,
): Promise<void> {
  for (const write of writes) {
    const unchanged = async () => {
      const current = await source(workspace, write.file);
      return (
        (current?.text ?? null) === write.before && (current?.identity ?? null) === write.identity
      );
    };
    if (!(await unchanged())) {
      throw new Error(`Workspace guide changed before write: ${write.file}`);
    }
    if (write.before === write.after) continue;
    await atomicWriteText(path.join(workspace, write.file), write.after, {
      containedRoot: workspace,
      exclusive: write.before === null,
      beforeCommit: async () => {
        if (!(await unchanged())) {
          throw new Error(`Workspace guide changed before commit: ${write.file}`);
        }
      },
    });
    await afterWrite?.(write.file);
  }
  await verifyWorkspaceGuides(workspace, writes);
}

export async function verifyWorkspaceGuides(
  workspace: string,
  writes: readonly GuideWrite[],
): Promise<void> {
  for (const write of writes) {
    if ((await source(workspace, write.file))?.text !== write.after) {
      throw new Error(`Workspace guide changed after materialization: ${write.file}`);
    }
  }
}
