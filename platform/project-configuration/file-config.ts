import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse, YAMLParseError } from 'yaml';

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

const SHARED_CONFIG = 'repoctopus.yaml';
const LOCAL_CONFIG = '.repoctopus/local.yaml';

async function readConfig<T>(
  workspace: string,
  file: string,
  validate: (value: unknown) => T,
  optional = false,
): Promise<T | null> {
  try {
    return validate(parse(await readFile(path.join(workspace, file), 'utf8')) as unknown);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const location = error.linePos?.[0];
      const at = location ? ` at line ${location.line}, column ${location.col}` : '';
      throw new Error(`${file}: invalid YAML${at} (${error.code})`, { cause: error });
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      if (optional) return null;
      throw Object.assign(
        new Error(`${file}: file not found in the selected Workspace`, { cause: error }),
        { code: error.code },
      );
    }
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

export function projectExecutionConfigDigests(
  shared: EffectiveProjectConfig['shared'],
  local: LocalProjectConfig | null,
) {
  // Collector routing is a deployment setting and does not change Run or Evidence inputs.
  const executionConfig = { ...shared };
  delete executionConfig.telemetry;
  const sharedDigest = hashProjectConfig(executionConfig);
  const localDigest = local ? hashProjectConfig(local) : null;
  const effectiveDigest = createHash('sha256')
    .update(canonicalJson({ sharedDigest, localDigest }))
    .digest('hex');
  return { sharedDigest, localDigest, effectiveDigest };
}

export async function loadProjectConfig(workspace: string): Promise<EffectiveProjectConfig> {
  const [shared, local] = await Promise.all([
    readConfig(workspace, SHARED_CONFIG, parseSharedProjectConfig),
    readConfig(
      workspace,
      LOCAL_CONFIG,
      (value) => (value === null ? null : parseLocalProjectConfig(value)),
      true,
    ),
  ]);
  if (!shared) throw new Error(`${SHARED_CONFIG}: expected shared configuration`);
  if (local?.repositoryPaths) {
    const repositoryIds = new Set(shared.repositories.map((repository) => repository.id));
    const unknown = Object.keys(local.repositoryPaths).filter((id) => !repositoryIds.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `${LOCAL_CONFIG}: Local config references unknown repositories: ${unknown.sort().join(', ')}`,
      );
    }
    if (local.repositoryPaths[shared.workspace.repositoryId] !== undefined) {
      throw new Error(
        `${LOCAL_CONFIG}: Local config cannot override the Workspace Repository path`,
      );
    }
  }
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
    ...projectExecutionConfigDigests(shared, local),
  };
}
