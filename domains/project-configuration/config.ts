import { createHash } from 'node:crypto';
import path from 'node:path';

import { canonicalJson, canonicalValue } from '../workflow-contract/canonical.js';
import type { DeliveryPolicy } from '../delivery/types.js';
import { validateDeliveryPolicy } from '../delivery/validation.js';
import {
  BROWSER_JOURNEY_API_VERSION,
  compileBrowserJourney,
  type BrowserJourney,
} from '../feedback/browser.js';
import type { ReadinessCondition } from '../feedback/service.js';
import { normalizePostMergeVerificationPathPrefixes } from '../post-merge/closure.js';
import {
  PROJECT_CONFIG_API_VERSION,
  type BrowserNodeConfig,
  type CapabilityProviderReference,
  type CommandNodeConfig,
  type CredentialReference,
  type EvidenceNodeConfig,
  type LocalProjectConfig,
  type PlatformEventsConfig,
  type PostMergeConfig,
  type ServiceNodeConfig,
  type SharedProjectConfig,
  type SpecificationNodeConfig,
  type VisualNodeConfig,
  type TeamPluginConfig,
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

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ProjectConfigError('expected an array', field);
  return value.map((item, index) => string(item, `${field}[${index}]`));
}

function identifier(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(parsed)) {
    throw new ProjectConfigError('expected a stable identifier', field);
  }
  return parsed;
}

function credentialReference(value: unknown, field: string): CredentialReference {
  const reference = object(value, field);
  exactKeys(reference, ['provider', 'variable'], field);
  if (reference.provider !== 'environment') {
    throw new ProjectConfigError('expected environment Credential Provider', `${field}.provider`);
  }
  const variable = string(reference.variable, `${field}.variable`);
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(variable)) {
    throw new ProjectConfigError('expected an environment variable name', `${field}.variable`);
  }
  return { provider: 'environment', variable };
}

function providerReference(value: unknown, field: string): CapabilityProviderReference {
  const reference = object(value, field);
  exactKeys(reference, ['id'], field);
  return { id: identifier(reference.id, `${field}.id`) };
}

function concreteDirectory(value: unknown, field: string): string {
  const configured = string(value, field);
  const normalized = configured.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  if (
    configured !== normalized ||
    normalized !== `${segments.join('/')}/` ||
    normalized.startsWith('/') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.length < 2 ||
    segments.some((segment) => segment === '.' || segment === '..') ||
    /[*?[\]{}!]/u.test(normalized) ||
    [...normalized].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new ProjectConfigError(
      'expected a concrete project-relative directory below the project root',
      field,
    );
  }
  return normalized;
}

function projectRelativeDirectory(value: unknown, field: string): string {
  const configured = string(value, field);
  const normalized = configured.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  const canonical = segments.join('/');
  if (
    configured !== canonical ||
    normalized.startsWith('/') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.length === 0 ||
    segments.some((segment) => segment === '.' || segment === '..') ||
    /[*?[\]{}!]/u.test(normalized) ||
    [...normalized].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new ProjectConfigError('expected a project-relative directory', field);
  }
  return normalized;
}

function parsePlatformEvents(value: unknown): PlatformEventsConfig {
  const config = object(value, 'platformEvents');
  exactKeys(config, ['storeProvider', 'http', 'github', 'runner'], 'platformEvents');

  const http = object(config.http, 'platformEvents.http');
  exactKeys(http, ['hostname', 'port', 'shutdownTimeoutMs'], 'platformEvents.http');
  const github = object(config.github, 'platformEvents.github');
  exactKeys(
    github,
    ['source', 'path', 'maxBodyBytes', 'webhookCredential', 'apiCredential'],
    'platformEvents.github',
  );
  const routePath = string(github.path, 'platformEvents.github.path');
  if (!routePath.startsWith('/') || routePath.includes('?') || routePath.includes('#')) {
    throw new ProjectConfigError(
      'expected an absolute HTTP route path',
      'platformEvents.github.path',
    );
  }
  const runner = object(config.runner, 'platformEvents.runner');
  exactKeys(
    runner,
    ['identity', 'leaseMs', 'pollIntervalMs', 'retryDelayMs', 'maxAttempts', 'shutdownTimeoutMs'],
    'platformEvents.runner',
  );
  return {
    storeProvider: providerReference(config.storeProvider, 'platformEvents.storeProvider'),
    http: {
      hostname: string(http.hostname, 'platformEvents.http.hostname'),
      port: portNumber(http.port, 'platformEvents.http.port'),
      shutdownTimeoutMs: positiveInteger(
        http.shutdownTimeoutMs,
        'platformEvents.http.shutdownTimeoutMs',
        5_000,
      ),
    },
    github: {
      source: identifier(github.source, 'platformEvents.github.source'),
      path: routePath,
      maxBodyBytes: positiveInteger(
        github.maxBodyBytes,
        'platformEvents.github.maxBodyBytes',
        1024 * 1024,
      ),
      webhookCredential: credentialReference(
        github.webhookCredential,
        'platformEvents.github.webhookCredential',
      ),
      apiCredential: credentialReference(
        github.apiCredential,
        'platformEvents.github.apiCredential',
      ),
    },
    runner: {
      identity: identifier(runner.identity, 'platformEvents.runner.identity'),
      leaseMs: positiveInteger(runner.leaseMs, 'platformEvents.runner.leaseMs', 30_000),
      pollIntervalMs: positiveInteger(
        runner.pollIntervalMs,
        'platformEvents.runner.pollIntervalMs',
        1_000,
      ),
      retryDelayMs: positiveInteger(
        runner.retryDelayMs,
        'platformEvents.runner.retryDelayMs',
        1_000,
      ),
      maxAttempts: positiveInteger(runner.maxAttempts, 'platformEvents.runner.maxAttempts', 5),
      shutdownTimeoutMs: positiveInteger(
        runner.shutdownTimeoutMs,
        'platformEvents.runner.shutdownTimeoutMs',
        5_000,
      ),
    },
  };
}

function parsePostMerge(value: unknown): PostMergeConfig {
  const config = object(value, 'postMerge');
  exactKeys(
    config,
    ['runnerIdentity', 'temporaryRoot', 'evidenceProfile', 'allowedWorkspacePaths', 'publication'],
    'postMerge',
  );
  const allowed = object(config.allowedWorkspacePaths, 'postMerge.allowedWorkspacePaths');
  exactKeys(
    allowed,
    ['specificationClosure', 'verificationPathPrefixes'],
    'postMerge.allowedWorkspacePaths',
  );
  if (allowed.specificationClosure !== true) {
    throw new ProjectConfigError(
      'must delegate specification paths to the active Specification Provider',
      'postMerge.allowedWorkspacePaths.specificationClosure',
    );
  }
  if (!Array.isArray(allowed.verificationPathPrefixes)) {
    throw new ProjectConfigError(
      'expected an array',
      'postMerge.allowedWorkspacePaths.verificationPathPrefixes',
    );
  }
  const concretePrefixes = allowed.verificationPathPrefixes.map((item, index) =>
    concreteDirectory(item, `postMerge.allowedWorkspacePaths.verificationPathPrefixes[${index}]`),
  );
  let verificationPathPrefixes: string[];
  try {
    verificationPathPrefixes = normalizePostMergeVerificationPathPrefixes(concretePrefixes);
  } catch (error) {
    throw new ProjectConfigError(
      error instanceof Error ? error.message : 'invalid verification path prefix',
      'postMerge.allowedWorkspacePaths.verificationPathPrefixes',
    );
  }

  const publication = object(config.publication, 'postMerge.publication');
  if (
    'changeMergeRequest' in publication ||
    (Array.isArray(publication.operations) &&
      publication.operations.includes('merge_request.update'))
  ) {
    throw new ProjectConfigError(
      'legacy update-existing publication is read-only; configure merge_target, commit, push, merge_request.create_or_recover, and finalChangeMergeRequest',
      'postMerge.publication',
    );
  }
  exactKeys(
    publication,
    ['operations', 'remote', 'commit', 'finalChangeMergeRequest'],
    'postMerge.publication',
  );
  const operations = stringArray(publication.operations, 'postMerge.publication.operations');
  if (
    canonicalJson([...operations].sort()) !==
    canonicalJson(['commit', 'merge_request.create_or_recover', 'merge_target', 'push'])
  ) {
    throw new ProjectConfigError(
      'must contain only merge_target, commit, push, and merge_request.create_or_recover',
      'postMerge.publication.operations',
    );
  }
  const commit = object(publication.commit, 'postMerge.publication.commit');
  exactKeys(
    commit,
    ['message', 'authorNameCredential', 'authorEmailCredential'],
    'postMerge.publication.commit',
  );
  const message = string(commit.message, 'postMerge.publication.commit.message');
  if (message.includes('\n') || message.includes('\r')) {
    throw new ProjectConfigError('must be one line', 'postMerge.publication.commit.message');
  }
  const mergeRequest = object(
    publication.finalChangeMergeRequest,
    'postMerge.publication.finalChangeMergeRequest',
  );
  exactKeys(mergeRequest, ['title', 'body'], 'postMerge.publication.finalChangeMergeRequest');
  const remote = identifier(publication.remote, 'postMerge.publication.remote');
  return {
    runnerIdentity: identifier(config.runnerIdentity, 'postMerge.runnerIdentity'),
    temporaryRoot: projectRelativeDirectory(config.temporaryRoot, 'postMerge.temporaryRoot'),
    evidenceProfile: identifier(config.evidenceProfile, 'postMerge.evidenceProfile'),
    allowedWorkspacePaths: { specificationClosure: true, verificationPathPrefixes },
    publication: {
      operations: ['merge_target', 'commit', 'push', 'merge_request.create_or_recover'],
      remote,
      commit: {
        message,
        authorNameCredential: credentialReference(
          commit.authorNameCredential,
          'postMerge.publication.commit.authorNameCredential',
        ),
        authorEmailCredential: credentialReference(
          commit.authorEmailCredential,
          'postMerge.publication.commit.authorEmailCredential',
        ),
      },
      finalChangeMergeRequest: {
        title: string(mergeRequest.title, 'postMerge.publication.finalChangeMergeRequest.title'),
        body: string(mergeRequest.body, 'postMerge.publication.finalChangeMergeRequest.body'),
      },
    },
  };
}

function nodeBase(node: Record<string, unknown>, field: string) {
  return {
    id: string(node.id, `${field}.id`),
    repository: string(node.repository, `${field}.repository`),
    dependsOn: stringArray(node.dependsOn ?? [], `${field}.dependsOn`),
    required: boolean(node.required, `${field}.required`, true),
  };
}

function parseCommandNode(value: unknown, field: string): CommandNodeConfig {
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
  const args = stringArray(node.args ?? [], `${field}.args`);
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
    ...nodeBase(node, field),
    type: 'command',
    executable: string(node.executable, `${field}.executable`),
    args,
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

function parseReadiness(value: unknown, field: string): ReadinessCondition[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProjectConfigError('expected at least one readiness condition', field);
  }
  return value.map((item, index) => {
    const currentField = `${field}[${index}]`;
    const condition = object(item, currentField);
    if (condition.type === 'tcp') {
      exactKeys(condition, ['type', 'host', 'port'], currentField);
      return {
        type: 'tcp',
        host: string(condition.host, `${currentField}.host`),
        port: portNumber(condition.port, `${currentField}.port`),
      };
    }
    if (condition.type === 'http') {
      exactKeys(condition, ['type', 'url', 'statusCodes', 'jsonPath', 'equals'], currentField);
      const url = string(condition.url, `${currentField}.url`);
      try {
        new URL(url);
      } catch {
        throw new ProjectConfigError('expected an absolute URL', `${currentField}.url`);
      }
      let statusCodes: number[] | undefined;
      if (condition.statusCodes !== undefined) {
        if (!Array.isArray(condition.statusCodes) || condition.statusCodes.length === 0) {
          throw new ProjectConfigError('expected a non-empty array', `${currentField}.statusCodes`);
        }
        statusCodes = condition.statusCodes.map((status, statusIndex) => {
          const parsed = positiveInteger(
            status,
            `${currentField}.statusCodes[${statusIndex}]`,
            200,
          );
          if (parsed > 599) {
            throw new ProjectConfigError(
              'expected an HTTP status from 100 to 599',
              `${currentField}.statusCodes[${statusIndex}]`,
            );
          }
          return parsed;
        });
      }
      return {
        type: 'http',
        url,
        ...(statusCodes ? { statusCodes } : {}),
        ...(condition.jsonPath !== undefined
          ? { jsonPath: string(condition.jsonPath, `${currentField}.jsonPath`) }
          : {}),
        ...(condition.equals !== undefined ? { equals: condition.equals } : {}),
      };
    }
    if (condition.type === 'log') {
      exactKeys(condition, ['type', 'pattern', 'stream'], currentField);
      const stream = condition.stream;
      if (
        stream !== undefined &&
        stream !== 'stdout' &&
        stream !== 'stderr' &&
        stream !== 'combined'
      ) {
        throw new ProjectConfigError(
          'expected stdout, stderr, or combined',
          `${currentField}.stream`,
        );
      }
      return {
        type: 'log',
        pattern: string(condition.pattern, `${currentField}.pattern`),
        ...(stream ? { stream } : {}),
      };
    }
    throw new ProjectConfigError('unsupported readiness type', `${currentField}.type`);
  });
}

function parseServiceNode(value: unknown, field: string): ServiceNodeConfig {
  const node = object(value, field);
  const common = [
    'id',
    'type',
    'mode',
    'repository',
    'dependsOn',
    'required',
    'readiness',
    'startupTimeoutMs',
    'probeIntervalMs',
  ];
  if (node.type !== 'service') {
    throw new ProjectConfigError('expected service', `${field}.type`);
  }
  const mode = node.mode;
  if (mode === 'managed') {
    exactKeys(node, [...common, 'executable', 'args', 'cwd', 'resourceKeys'], field);
    const cwd = node.cwd;
    if (cwd !== undefined && typeof cwd !== 'string') {
      throw new ProjectConfigError('expected a string', `${field}.cwd`);
    }
    return {
      ...nodeBase(node, field),
      type: 'service',
      mode: 'managed',
      executable: string(node.executable, `${field}.executable`),
      args: stringArray(node.args ?? [], `${field}.args`),
      ...(cwd !== undefined ? { cwd } : {}),
      readiness: parseReadiness(node.readiness, `${field}.readiness`),
      startupTimeoutMs: positiveInteger(node.startupTimeoutMs, `${field}.startupTimeoutMs`, 60_000),
      ...(node.probeIntervalMs !== undefined
        ? {
            probeIntervalMs: positiveInteger(node.probeIntervalMs, `${field}.probeIntervalMs`, 100),
          }
        : {}),
      ...(node.resourceKeys !== undefined
        ? { resourceKeys: stringArray(node.resourceKeys, `${field}.resourceKeys`) }
        : {}),
    };
  }
  if (mode === 'attached') {
    exactKeys(node, [...common, 'buildIdentity'], field);
    let parsedBuildIdentity: { url: string; jsonPath: string } | undefined;
    if (node.buildIdentity !== undefined) {
      const identity = object(node.buildIdentity, `${field}.buildIdentity`);
      exactKeys(identity, ['url', 'jsonPath'], `${field}.buildIdentity`);
      parsedBuildIdentity = {
        url: string(identity.url, `${field}.buildIdentity.url`),
        jsonPath: string(identity.jsonPath, `${field}.buildIdentity.jsonPath`),
      };
    }
    return {
      ...nodeBase(node, field),
      type: 'service',
      mode: 'attached',
      readiness: parseReadiness(node.readiness, `${field}.readiness`),
      startupTimeoutMs: positiveInteger(node.startupTimeoutMs, `${field}.startupTimeoutMs`, 60_000),
      ...(node.probeIntervalMs !== undefined
        ? {
            probeIntervalMs: positiveInteger(node.probeIntervalMs, `${field}.probeIntervalMs`, 100),
          }
        : {}),
      ...(parsedBuildIdentity ? { buildIdentity: parsedBuildIdentity } : {}),
    };
  }
  throw new ProjectConfigError('expected managed or attached', `${field}.mode`);
}

function parseBrowserNode(value: unknown, field: string): BrowserNodeConfig {
  const node = object(value, field);
  exactKeys(
    node,
    ['id', 'type', 'repository', 'dependsOn', 'required', 'source', 'journey'],
    field,
  );
  if (node.type !== 'browser') {
    throw new ProjectConfigError('expected browser', `${field}.type`);
  }
  if (node.source !== 'managed' && node.source !== 'system') {
    throw new ProjectConfigError('expected managed or system', `${field}.source`);
  }
  let journey: BrowserJourney;
  try {
    journey = compileBrowserJourney(node.journey as BrowserJourney);
  } catch (error) {
    throw new ProjectConfigError((error as Error).message, `${field}.journey`);
  }
  return {
    ...nodeBase(node, field),
    type: 'browser',
    source: node.source,
    journey: {
      apiVersion: BROWSER_JOURNEY_API_VERSION,
      kind: 'BrowserJourney',
      journeyId: journey.journeyId,
      viewport: journey.viewport,
      timeoutMs: journey.timeoutMs,
      actions: journey.actions,
    },
  };
}

function parseVisualNode(value: unknown, field: string): VisualNodeConfig {
  const node = object(value, field);
  exactKeys(
    node,
    [
      'id',
      'type',
      'repository',
      'dependsOn',
      'required',
      'changeId',
      'browserNode',
      'pageUrl',
      'criteria',
    ],
    field,
  );
  if (node.type !== 'visual') {
    throw new ProjectConfigError('expected visual', `${field}.type`);
  }
  if (!Array.isArray(node.criteria) || node.criteria.length === 0) {
    throw new ProjectConfigError('expected at least one criterion', `${field}.criteria`);
  }
  return {
    ...nodeBase(node, field),
    type: 'visual',
    changeId: string(node.changeId, `${field}.changeId`),
    browserNode: string(node.browserNode, `${field}.browserNode`),
    pageUrl: string(node.pageUrl, `${field}.pageUrl`),
    criteria: node.criteria.map((item, index) => {
      const criterion = object(item, `${field}.criteria[${index}]`);
      exactKeys(criterion, ['id', 'text', 'sourceRef'], `${field}.criteria[${index}]`);
      return {
        id: string(criterion.id, `${field}.criteria[${index}].id`),
        text: string(criterion.text, `${field}.criteria[${index}].text`),
        ...(criterion.sourceRef !== undefined
          ? {
              sourceRef: string(criterion.sourceRef, `${field}.criteria[${index}].sourceRef`),
            }
          : {}),
      };
    }),
  };
}

function parseSpecificationNode(value: unknown, field: string): SpecificationNodeConfig {
  const node = object(value, field);
  exactKeys(
    node,
    ['id', 'type', 'repository', 'dependsOn', 'required', 'changeId', 'strict'],
    field,
  );
  if (node.type !== 'specification') {
    throw new ProjectConfigError('expected specification', `${field}.type`);
  }
  return {
    ...nodeBase(node, field),
    type: 'specification',
    changeId: string(node.changeId, `${field}.changeId`),
    strict: boolean(node.strict, `${field}.strict`, true),
  };
}

function parseEvidenceNode(value: unknown, field: string): EvidenceNodeConfig {
  const node = object(value, field);
  if (node.type === 'command') return parseCommandNode(node, field);
  if (node.type === 'service') return parseServiceNode(node, field);
  if (node.type === 'browser') return parseBrowserNode(node, field);
  if (node.type === 'visual') return parseVisualNode(node, field);
  if (node.type === 'specification') return parseSpecificationNode(node, field);
  throw new ProjectConfigError('unsupported node type', `${field}.type`);
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
    [
      'apiVersion',
      'kind',
      'workspace',
      'repositories',
      'profiles',
      'composition',
      'evidence',
      'delivery',
      'skillProviders',
      'specificationProvider',
      'platformEvents',
      'postMerge',
    ],
    'config',
  );
  if (root.apiVersion !== PROJECT_CONFIG_API_VERSION)
    throw new ProjectConfigError('unsupported apiVersion', 'apiVersion');
  if (root.kind !== 'RepoctopusWorkspace')
    throw new ProjectConfigError('expected RepoctopusWorkspace', 'kind');

  const workspace = object(root.workspace, 'workspace');
  exactKeys(workspace, ['id', 'repositoryId'], 'workspace');
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
  const workspaceRepositoryId = identifier(workspace.repositoryId, 'workspace.repositoryId');
  const workspaceRepository = repositories.find(
    (repository) => repository.id === workspaceRepositoryId,
  );
  if (!workspaceRepository) {
    throw new ProjectConfigError(
      'must reference a registered repository',
      'workspace.repositoryId',
    );
  }
  if (workspaceRepository.path !== '.') {
    throw new ProjectConfigError(
      'Workspace Repository path must be . so it contains repoctopus.yaml and shared workflow artifacts',
      `repositories.${workspaceRepositoryId}.path`,
    );
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
        parseEvidenceNode(node, `profiles[${index}].nodes[${nodeIndex}]`),
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
  let skillProviders: SharedProjectConfig['skillProviders'];
  if (root.skillProviders !== undefined) {
    if (!Array.isArray(root.skillProviders) || root.skillProviders.length === 0) {
      throw new ProjectConfigError('expected at least one Provider reference', 'skillProviders');
    }
    skillProviders = root.skillProviders.map((provider, index) =>
      providerReference(provider, `skillProviders[${index}]`),
    );
    if (new Set(skillProviders.map((provider) => provider.id)).size !== skillProviders.length) {
      throw new ProjectConfigError('Provider ids must be unique', 'skillProviders');
    }
  }
  const specificationProvider =
    root.specificationProvider === undefined
      ? undefined
      : providerReference(root.specificationProvider, 'specificationProvider');
  const platformEvents =
    root.platformEvents === undefined ? undefined : parsePlatformEvents(root.platformEvents);
  const postMerge = root.postMerge === undefined ? undefined : parsePostMerge(root.postMerge);
  if (postMerge && !platformEvents) {
    throw new ProjectConfigError(
      'requires platformEvents Runner configuration',
      'postMerge.runnerIdentity',
    );
  }
  if (postMerge && !delivery) {
    throw new ProjectConfigError('requires a shared Delivery policy', 'postMerge.publication');
  }
  if (platformEvents && postMerge && platformEvents.runner.identity !== postMerge.runnerIdentity) {
    throw new ProjectConfigError(
      'must reference platformEvents.runner.identity',
      'postMerge.runnerIdentity',
    );
  }
  if (postMerge && !profiles.some((profile) => profile.id === postMerge.evidenceProfile)) {
    throw new ProjectConfigError(
      'must reference an existing Evidence profile',
      'postMerge.evidenceProfile',
    );
  }
  let composition: SharedProjectConfig['composition'];
  if (root.composition !== undefined) {
    const raw = object(root.composition, 'composition');
    exactKeys(raw, ['plugins'], 'composition');
    if (!Array.isArray(raw.plugins)) {
      throw new ProjectConfigError('expected an array', 'composition.plugins');
    }
    const plugins: TeamPluginConfig[] = raw.plugins.map((item, index) => {
      const field = `composition.plugins[${index}]`;
      const plugin = object(item, field);
      exactKeys(plugin, ['id', 'descriptor', 'module', 'config'], field);
      const descriptor = string(plugin.descriptor, `${field}.descriptor`);
      const module = string(plugin.module, `${field}.module`);
      if (
        path.isAbsolute(descriptor) ||
        path.win32.isAbsolute(descriptor) ||
        path.isAbsolute(module) ||
        path.win32.isAbsolute(module)
      ) {
        throw new ProjectConfigError('plugin paths must be relative', field);
      }
      return {
        id: string(plugin.id, `${field}.id`),
        descriptor,
        module,
        ...(plugin.config === undefined ? {} : { config: canonicalValue(plugin.config) }),
      };
    });
    if (new Set(plugins.map((plugin) => plugin.id)).size !== plugins.length) {
      throw new ProjectConfigError('plugin ids must be unique', 'composition.plugins');
    }
    composition = { plugins };
  }

  return {
    apiVersion: PROJECT_CONFIG_API_VERSION,
    kind: 'RepoctopusWorkspace',
    workspace: {
      id: identifier(workspace.id, 'workspace.id'),
      repositoryId: workspaceRepositoryId,
    },
    repositories,
    profiles,
    ...(composition ? { composition } : {}),
    ...(evidence ? { evidence } : {}),
    ...(delivery ? { delivery } : {}),
    ...(skillProviders ? { skillProviders } : {}),
    ...(specificationProvider ? { specificationProvider } : {}),
    ...(platformEvents ? { platformEvents } : {}),
    ...(postMerge ? { postMerge } : {}),
  };
}

export function parseLocalProjectConfig(value: unknown): LocalProjectConfig {
  const root = object(value, 'local');
  exactKeys(
    root,
    ['apiVersion', 'kind', 'repositoryPaths', 'ports', 'browser', 'visual', 'resources'],
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
  let visual: LocalProjectConfig['visual'];
  if (root.visual !== undefined) {
    const value = object(root.visual, 'visual');
    exactKeys(value, ['exchangeDirectory', 'responseTimeoutMs'], 'visual');
    visual = {
      exchangeDirectory: string(value.exchangeDirectory, 'visual.exchangeDirectory'),
      ...(value.responseTimeoutMs !== undefined
        ? {
            responseTimeoutMs: positiveInteger(
              value.responseTimeoutMs,
              'visual.responseTimeoutMs',
              1,
            ),
          }
        : {}),
    };
  }
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
    ...(visual ? { visual } : {}),
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
  if (copy.kind === 'RepoctopusWorkspace') {
    copy.repositories = copy.repositories.map((repository) => ({
      ...repository,
      path: normalizePathText(repository.path),
    }));
    for (const profile of copy.profiles) {
      for (const node of profile.nodes) {
        if ('cwd' in node && node.cwd !== undefined) node.cwd = normalizePathText(node.cwd);
      }
    }
    if (copy.postMerge) {
      copy.postMerge.temporaryRoot = normalizePathText(copy.postMerge.temporaryRoot);
      copy.postMerge.allowedWorkspacePaths.verificationPathPrefixes =
        copy.postMerge.allowedWorkspacePaths.verificationPathPrefixes.map(normalizePathText);
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
