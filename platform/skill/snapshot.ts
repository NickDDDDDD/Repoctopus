import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { WorkSkillResource } from '../../domains/change-lifecycle/work-context.js';
import type { SkillUsageSnapshot } from '../../domains/skill/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const MAX_SKILL_RESOURCE_BYTES = 1024 * 1024;
const MAX_SKILL_RESOURCE_FILES = 128;

interface ResourceCollector {
  files: WorkSkillResource[];
  remainingBytes: number;
}

async function collectResource(
  file: string,
  relative: string,
  collector: ResourceCollector,
): Promise<Buffer> {
  if (collector.files.length >= MAX_SKILL_RESOURCE_FILES) {
    throw new Error(`Work Skill resource count exceeded: ${relative}`);
  }
  const { bytes } = await readFileRaceSafe(file, Math.max(1, collector.remainingBytes), {
    bigint: true,
    label: `Work Skill resource ${relative}`,
    verify: (_stage, { realPath }) => {
      if (path.relative(file, realPath)) throw new Error(`Unsafe Work Skill resource: ${relative}`);
    },
  });
  collector.remainingBytes -= bytes.length;
  if (collector.remainingBytes < 0)
    throw new Error(`Work Skill resource byte limit exceeded: ${relative}`);
  const decoded = bytes.toString('utf8');
  const utf8 = Buffer.from(decoded, 'utf8').equals(bytes);
  collector.files.push({
    path: relative,
    digest: sha256(bytes),
    encoding: utf8 ? 'utf8' : 'base64',
    content: utf8 ? decoded : bytes.toString('base64'),
  });
  return bytes;
}

async function directoryManifest(
  directory: string,
  prefix = '',
  collector?: ResourceCollector,
): Promise<unknown[]> {
  if (collector) {
    const stat = await lstat(directory);
    const resolved = await realpath(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(directory, resolved)) {
      throw new Error(`Unsafe Work Skill resource directory: ${prefix || '.'}`);
    }
  }
  const manifest: unknown[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (collector && (/[\\\\:]/u.test(entry.name) || (!entry.isFile() && !entry.isDirectory()))) {
      throw new Error(`Unsafe Work Skill resource: ${relative}`);
    }
    if (entry.isDirectory())
      manifest.push(...(await directoryManifest(absolute, relative, collector)));
    else if (entry.isFile() && relative !== 'SKILL.md') {
      const contents = collector
        ? await collectResource(absolute, relative, collector)
        : await readFile(absolute);
      manifest.push({ path: relative, sha256: sha256(contents), size: contents.byteLength });
    }
  }
  return manifest.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function snapshot(
  definition: SkillDefinition,
  collector?: ResourceCollector,
): Promise<SkillUsageSnapshot> {
  let resourceIdentity: unknown = definition.resourceBase ?? null;
  if (definition.resourceBase?.kind === 'directory') {
    resourceIdentity = await directoryManifest(definition.resourceBase.path, '', collector);
  }
  return {
    schemaVersion: 1,
    name: definition.name,
    provider: definition.provider,
    invocation: { ...definition.invocation },
    contentDigest: sha256(definition.content),
    resourceManifestDigest: sha256(canonicalJson(resourceIdentity)),
  };
}

export function snapshotSkillDefinition(definition: SkillDefinition): Promise<SkillUsageSnapshot> {
  return snapshot(definition);
}

export async function captureWorkSkill(definition: SkillDefinition): Promise<{
  snapshot: SkillUsageSnapshot;
  resources: WorkSkillResource[];
}> {
  if (definition.resourceBase && definition.resourceBase.kind !== 'directory') {
    throw new Error(
      `Work Skill resources are not available from a managed directory: ${definition.name}`,
    );
  }
  const collector: ResourceCollector = { files: [], remainingBytes: MAX_SKILL_RESOURCE_BYTES };
  const identity = await snapshot(definition, collector);
  return {
    snapshot: identity,
    resources: collector.files.sort((a, b) => a.path.localeCompare(b.path, 'en')),
  };
}
