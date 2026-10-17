import { createHash } from 'node:crypto';
import path from 'node:path';

import { canonicalJson, canonicalValue } from '../workflow-contract/canonical.js';
import type { DeliveryPolicy } from '../delivery/types.js';
import { validateDeliveryPolicy } from '../delivery/validation.js';
import {
  PROJECT_CONFIG_API_VERSION,
  type EvidenceNodeConfig,
  type LocalProjectConfig,
  type SharedProjectConfig,
} from './types.js';

export class ProjectConfigError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(field ? `${field}: ${message}` : message);
    this.name = 'ProjectConfigError';
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectConfigError('expected an object', field);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectConfigError('expected a non-empty string', field);
  }
  return value;
}

function boolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ProjectConfigError('expected a boolean', field);
  return value;
}

function positiveInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new ProjectConfigError('expected a positive integer', field);
  }
  return Number(value);
}

function portNumber(value: unknown, field: string): number {
  const port = positiveInteger(value, field, 1);
  if (port > 65_535) throw new ProjectConfigError('expected a port from 1 to 65535', field);
  return port;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ProjectConfigError(`unknown fields: ${unknown.sort().join(', ')}`, field);
  }
}

function parseCommandNode(value: unknown, field: string): EvidenceNodeConfig {
  const node = object(value, field);
  exactKeys(
    node,
    [
      'id',
      'type',
      'repository',
      'dependsOn',
      'required',
      'executable',
      'args',
      'cwd',
      'timeoutMs',
      'cache',
      'cacheTtlMs',
      'zeroTests',
    ],
    field,
  );
  if (node.type !== 'command')
    throw new ProjectConfigError('unsupported node type', `${field}.type`);
  const dependsOn = node.dependsOn ?? [];
  const args = node.args ?? [];
  if (!Array.isArray(dependsOn))
    throw new ProjectConfigError('expected an array', `${field}.dependsOn`);
  if (!Array.isArray(args)) throw new ProjectConfigError('expected an array', `${field}.args`);
  const cwd = node.cwd;
  if (cwd !== undefined && typeof cwd !== 'string') {
    throw new ProjectConfigError('expected a string', `${field}.cwd`);
  }
  const zeroTests = node.zeroTests;
  if (
    zeroTests !== undefined &&
    zeroTests !== 'ignore' &&
    zeroTests !== 'warning' &&
    zeroTests !== 'blocking'
  ) {
    throw new ProjectConfigError('expected ignore, warning, or blocking', `${field}.zeroTests`);
  }
  return {
    id: string(node.id, `${field}.id`),
    type: 'command',
    repository: string(node.repository, `${field}.repository`),
    dependsOn: dependsOn.map((item, index) => string(item, `${field}.dependsOn[${index}]`)),
    required: boolean(node.required, `${field}.required`, true),
    executable: string(node.executable, `${field}.executable`),
    args: args.map((item, index) => string(item, `${field}.args[${index}]`)),
    ...(cwd !== undefined ? { cwd } : {}),
    timeoutMs: positiveInteger(node.timeoutMs, `${field}.timeoutMs`, 10 * 60_000),
    cache: boolean(node.cache, `${field}.cache`, false),
    ...(node.cacheTtlMs !== undefined
      ? {
          cacheTtlMs: positiveInteger(node.cacheTtlMs, `${field}.cacheTtlMs`, 60 * 60_000),
        }
      : {}),
    ...(zeroTests !== undefined ? { zeroTests } : {}),
  };
}

function parseDeliveryConfig(value: unknown): NonNullable<SharedProjectConfig['delivery']> {
  const raw = object(value, 'delivery');
  exactKeys(raw, ['checkpoint', 'publication'], 'delivery');
  const policy: unknown = {
    apiVersion: PROJECT_CONFIG_API_VERSION,
    kind: 'DeliveryPolicy',
    ...raw,
  };
  const findings = validateDeliveryPolicy(policy);
  if (findings.length > 0) {
    throw new ProjectConfigError(
      findings.map((finding) => `${finding.path || 'delivery'}: ${finding.message}`).join('; '),
      'delivery',
    );
  }
  const validated = policy as DeliveryPolicy;
  return {
    checkpoint: structuredClone(validated.checkpoint),
    publication: structuredClone(validated.publication),
  };
}

export function parseSharedProjectConfig(value: unknown): SharedProjectConfig {
  const root = object(value, 'config');
  exactKeys(
    root,
    ['apiVersion', 'kind', 'project', 'repositories', 'profiles', 'evidence', 'delivery'],
    'config',
  );
  if (root.apiVersion !== PROJECT_CONFIG_API_VERSION)
    throw new ProjectConfigError('unsupported apiVersion', 'apiVersion');
  if (root.kind !== 'RepoctopusProject')
    throw new ProjectConfigError('expected RepoctopusProject', 'kind');

  const project = object(root.project, 'project');
  exactKeys(project, ['id'], 'project');
  if (!Array.isArray(root.repositories) || root.repositories.length === 0) {
    throw new ProjectConfigError('expected at least one repository', 'repositories');
  }
  const repositories = root.repositories.map((item, index) => {
    const repository = object(item, `repositories[${index}]`);
    exactKeys(repository, ['id', 'path'], `repositories[${index}]`);
    const configuredPath = string(repository.path, `repositories[${index}].path`);
    if (path.isAbsolute(configuredPath) || path.win32.isAbsolute(configuredPath)) {
      throw new ProjectConfigError(
        'shared repository path must be relative; use local repositoryPaths for absolute paths',
        `repositories[${index}].path`,
      );
    }
    return {
      id: string(repository.id, `repositories[${index}].id`),
      path: configuredPath,
    };
  });
  if (new Set(repositories.map((repository) => repository.id)).size !== repositories.length) {
    throw new ProjectConfigError('repository ids must be unique', 'repositories');
  }
  if (!Array.isArray(root.profiles) || root.profiles.length === 0) {
    throw new ProjectConfigError('expected at least one profile', 'profiles');
  }
  const profiles = root.profiles.map((item, index) => {
    const profile = object(item, `profiles[${index}]`);
    exactKeys(profile, ['id', 'nodes'], `profiles[${index}]`);
    if (!Array.isArray(profile.nodes) || profile.nodes.length === 0) {
      throw new ProjectConfigError('expected at least one node', `profiles[${index}].nodes`);
    }
    return {
      id: string(profile.id, `profiles[${index}].id`),
      nodes: profile.nodes.map((node, nodeIndex) =>
        parseCommandNode(node, `profiles[${index}].nodes[${nodeIndex}]`),
      ),
    };
  });
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new ProjectConfigError('profile ids must be unique', 'profiles');
  }

  let evidence: SharedProjectConfig['evidence'];
  if (root.evidence !== undefined) {
    const value = object(root.evidence, 'evidence');
    exactKeys(value, ['retention'], 'evidence');
    let retention: NonNullable<SharedProjectConfig['evidence']>['retention'];
    if (value.retention !== undefined) {
      const raw = object(value.retention, 'evidence.retention');
      exactKeys(raw, ['maxAgeDays', 'minRecentSuccesses'], 'evidence.retention');
      retention = {
        maxAgeDays: positiveInteger(raw.maxAgeDays, 'evidence.retention.maxAgeDays', 30),
        minRecentSuccesses: positiveInteger(
          raw.minRecentSuccesses,
          'evidence.retention.minRecentSuccesses',
          1,
        ),
      };
    }
    evidence = retention ? { retention } : {};
  }
  const delivery = root.delivery !== undefined ? parseDeliveryConfig(root.delivery) : undefined;

  return {
    apiVersion: PROJECT_CONFIG_API_VERSION,
    kind: 'RepoctopusProject',
    project: { id: string(project.id, 'project.id') },
    repositories,
    profiles,
    ...(evidence ? { evidence } : {}),
    ...(delivery ? { delivery } : {}),
  };
}

export function parseLocalProjectConfig(value: unknown): LocalProjectConfig {
  const root = object(value, 'local');
  exactKeys(
    root,
    ['apiVersion', 'kind', 'repositoryPaths', 'ports', 'browser', 'resources'],
    'local',
  );
  if (root.apiVersion !== PROJECT_CONFIG_API_VERSION)
    throw new ProjectConfigError('unsupported apiVersion', 'apiVersion');
  if (root.kind !== 'RepoctopusLocal')
    throw new ProjectConfigError('expected RepoctopusLocal', 'kind');

  let repositoryPaths: Record<string, string> | undefined;
  if (root.repositoryPaths !== undefined) {
    repositoryPaths = Object.fromEntries(
      Object.entries(object(root.repositoryPaths, 'repositoryPaths')).map(([key, item]) => [
        key,
        string(item, `repositoryPaths.${key}`),
      ]),
    );
  }
  let ports: Record<string, number> | undefined;
  if (root.ports !== undefined) {
    ports = Object.fromEntries(
      Object.entries(object(root.ports, 'ports')).map(([key, item]) => [
        key,
        portNumber(item, `ports.${key}`),
      ]),
    );
  }
  let browser: LocalProjectConfig['browser'];
  if (root.browser !== undefined) {
    const value = object(root.browser, 'browser');
    exactKeys(value, ['executablePath'], 'browser');
    browser = value.executablePath
      ? { executablePath: string(value.executablePath, 'browser.executablePath') }
      : {};
  }
  let resources: LocalProjectConfig['resources'];
  if (root.resources !== undefined) {
    const value = object(root.resources, 'resources');
    exactKeys(value, ['maxParallel', 'maxLogBytes'], 'resources');
    resources = {
      ...(value.maxParallel !== undefined
        ? { maxParallel: positiveInteger(value.maxParallel, 'resources.maxParallel', 1) }
        : {}),
      ...(value.maxLogBytes !== undefined
        ? { maxLogBytes: positiveInteger(value.maxLogBytes, 'resources.maxLogBytes', 1) }
        : {}),
    };
  }
  return {
    apiVersion: PROJECT_CONFIG_API_VERSION,
    kind: 'RepoctopusLocal',
    ...(repositoryPaths ? { repositoryPaths } : {}),
    ...(ports ? { ports } : {}),
    ...(browser ? { browser } : {}),
    ...(resources ? { resources } : {}),
  };
}

function normalizePathText(value: string): string {
  let normalized = value.replaceAll('\\', '/');
  const prefix = normalized.startsWith('//') ? '//' : '';
  normalized = `${prefix}${normalized.slice(prefix.length).replaceAll(/\/{2,}/g, '/')}`;
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return /^[A-Z]:\//.test(normalized)
    ? `${normalized[0]!.toLowerCase()}${normalized.slice(1)}`
    : normalized;
}

export function canonicalProjectConfig(value: SharedProjectConfig | LocalProjectConfig): unknown {
  const copy = structuredClone(value);
  if (copy.kind === 'RepoctopusProject') {
    copy.repositories = copy.repositories.map((repository) => ({
      ...repository,
      path: normalizePathText(repository.path),
    }));
    for (const profile of copy.profiles) {
      for (const node of profile.nodes) {
        if (node.cwd !== undefined) node.cwd = normalizePathText(node.cwd);
      }
    }
  } else {
    if (copy.repositoryPaths) {
      copy.repositoryPaths = Object.fromEntries(
        Object.entries(copy.repositoryPaths).map(([key, item]) => [key, normalizePathText(item)]),
      );
    }
    if (copy.browser?.executablePath) {
      copy.browser.executablePath = normalizePathText(copy.browser.executablePath);
    }
  }
  return canonicalValue(copy);
}

export function hashProjectConfig(value: SharedProjectConfig | LocalProjectConfig): string {
  return createHash('sha256')
    .update(canonicalJson(canonicalProjectConfig(value)))
    .digest('hex');
}

export function resolveRepositoryPath(
  workspace: string,
  configuredPath: string,
  localOverride?: string,
): string {
  return path.resolve(workspace, localOverride ?? configuredPath);
}
