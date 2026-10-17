import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import {
  hashProjectConfig,
  parseLocalProjectConfig,
  parseSharedProjectConfig,
  resolveRepositoryPath,
} from '../../domains/project-configuration/config.js';
import type {
  EffectiveProjectConfig,
  LocalProjectConfig,
} from '../../domains/project-configuration/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { createHash } from 'node:crypto';

async function optionalYaml(file: string): Promise<unknown> {
  try {
    return parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function loadProjectConfig(workspace: string): Promise<EffectiveProjectConfig> {
  const sharedFile = path.join(workspace, 'repoctopus.yaml');
  const localFile = path.join(workspace, '.repoctopus', 'local.yaml');
  const [sharedSource, localSource] = await Promise.all([
    readFile(sharedFile, 'utf8'),
    optionalYaml(localFile),
  ]);
  const shared = parseSharedProjectConfig(parse(sharedSource) as unknown);
  const local: LocalProjectConfig | null =
    localSource !== null ? parseLocalProjectConfig(localSource) : null;
  if (local?.repositoryPaths) {
    const repositoryIds = new Set(shared.repositories.map((repository) => repository.id));
    const unknown = Object.keys(local.repositoryPaths).filter((id) => !repositoryIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Local config references unknown repositories: ${unknown.sort().join(', ')}`);
    }
  }
  const sharedDigest = hashProjectConfig(shared);
  const localDigest = local ? hashProjectConfig(local) : null;
  const effectiveDigest = createHash('sha256')
    .update(canonicalJson({ sharedDigest, localDigest }))
    .digest('hex');
  return {
    shared,
    local,
    repositories: shared.repositories.map((repository) => ({
      ...repository,
      resolvedPath: resolveRepositoryPath(
        workspace,
        repository.path,
        local?.repositoryPaths?.[repository.id],
      ),
    })),
    sharedDigest,
    localDigest,
    effectiveDigest,
  };
}
