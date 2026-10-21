import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { SkillUsageSnapshot } from '../../domains/skill/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function directoryManifest(directory: string, prefix = ''): Promise<unknown[]> {
  const manifest: unknown[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) manifest.push(...(await directoryManifest(absolute, relative)));
    else if (entry.isFile() && relative !== 'SKILL.md') {
      const contents = await readFile(absolute);
      manifest.push({ path: relative, sha256: sha256(contents), size: contents.byteLength });
    }
  }
  return manifest.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export async function snapshotSkillDefinition(
  definition: SkillDefinition,
): Promise<SkillUsageSnapshot> {
  let resourceIdentity: unknown = definition.resourceBase ?? null;
  if (definition.resourceBase?.kind === 'directory') {
    resourceIdentity = await directoryManifest(definition.resourceBase.path);
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
