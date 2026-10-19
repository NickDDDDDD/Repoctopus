import { createHash } from 'node:crypto';

import type { Plugin } from '@deepseek-ai/cordis';

import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import type { CompositionKind } from '../../domains/composition/types.js';
import { normalizeStaticConfigSchema, type StaticConfigSchema } from './static-config-schema.js';

export const PLUGIN_CONTRACT_VERSION = 'repoctopus.plugin/v1alpha1' as const;

export type PluginKind = 'service-provider' | 'contributor' | 'application';
export type PluginSource = 'builtin' | 'team';
export type { CompositionKind } from '../../domains/composition/types.js';
export type PluginPermission = 'filesystem' | 'process' | 'network' | 'browser';

export interface PluginDescriptor {
  id: string;
  version: string;
  contractVersion: typeof PLUGIN_CONTRACT_VERSION;
  configSchemaVersion: string;
  configSchema?: StaticConfigSchema;
  kind: PluginKind;
  source: PluginSource;
  codeDigest: `sha256:${string}`;
  compositions: readonly CompositionKind[];
  authorities: readonly string[];
  permissions: readonly PluginPermission[];
  stateSchemas: Readonly<Record<string, string>>;
}

export interface BuiltinPluginRegistration {
  descriptor: PluginDescriptor;
  plugin: Plugin;
  defaultConfig?: unknown;
}

const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const KINDS = new Set<PluginKind>(['service-provider', 'contributor', 'application']);
const SOURCES = new Set<PluginSource>(['builtin', 'team']);
const COMPOSITIONS = new Set<CompositionKind>(['bootstrap', 'project']);
const PERMISSIONS = new Set<PluginPermission>(['filesystem', 'process', 'network', 'browser']);

function sortedUnique<T extends string>(
  values: readonly T[],
  field: string,
  allowed?: ReadonlySet<T>,
): T[] {
  const normalized = values.map((value) => value.trim() as T);
  if (normalized.some((value) => value.length === 0)) {
    throw new Error(`Plugin descriptor ${field} contains an empty value`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Plugin descriptor ${field} contains duplicate values`);
  }
  if (allowed && normalized.some((value) => !allowed.has(value))) {
    throw new Error(`Plugin descriptor ${field} contains an unsupported value`);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeStateSchemas(
  pluginId: string,
  schemas: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(schemas)
      .map(([name, version]) => [name.trim(), version.trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => {
        if (!IDENTIFIER.test(name) || !version) {
          throw new Error(`Invalid state schema for ${pluginId}: ${name}`);
        }
        return [name, version];
      }),
  );
}

export function normalizePluginDescriptor(input: PluginDescriptor): PluginDescriptor {
  const id = input.id.trim();
  if (!IDENTIFIER.test(id)) throw new Error(`Invalid plugin id: ${input.id}`);
  if (!VERSION.test(input.version)) throw new Error(`Invalid plugin version for ${id}`);
  if (input.contractVersion !== PLUGIN_CONTRACT_VERSION) {
    throw new Error(`Unsupported plugin contract for ${id}`);
  }
  if (!input.configSchemaVersion.trim()) {
    throw new Error(`Missing config schema version for ${id}`);
  }
  if (input.source === 'team' && input.configSchema === undefined) {
    throw new Error(`Missing static config schema for team plugin ${id}`);
  }
  if (!KINDS.has(input.kind)) throw new Error(`Invalid plugin kind for ${id}: ${input.kind}`);
  if (!SOURCES.has(input.source)) {
    throw new Error(`Invalid plugin source for ${id}: ${input.source}`);
  }
  if (!DIGEST.test(input.codeDigest)) throw new Error(`Invalid code digest for ${id}`);

  return {
    id,
    version: input.version,
    contractVersion: input.contractVersion,
    configSchemaVersion: input.configSchemaVersion.trim(),
    ...(input.configSchema === undefined
      ? {}
      : { configSchema: normalizeStaticConfigSchema(input.configSchema) }),
    kind: input.kind,
    source: input.source,
    codeDigest: input.codeDigest,
    compositions: sortedUnique(input.compositions, `${id}.compositions`, COMPOSITIONS),
    authorities: sortedUnique(input.authorities, `${id}.authorities`),
    permissions: sortedUnique(input.permissions, `${id}.permissions`, PERMISSIONS),
    stateSchemas: normalizeStateSchemas(id, input.stateSchemas),
  };
}

export function descriptorDigest(descriptor: PluginDescriptor): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(canonicalJson(normalizePluginDescriptor(descriptor)))
    .digest('hex')}`;
}

export function createBuiltinCatalog(
  registrations: readonly BuiltinPluginRegistration[],
): ReadonlyMap<string, BuiltinPluginRegistration> {
  const catalog = new Map<string, BuiltinPluginRegistration>();
  for (const registration of registrations) {
    const descriptor = normalizePluginDescriptor(registration.descriptor);
    if (descriptor.source !== 'builtin') {
      throw new Error(
        `Builtin catalog cannot contain ${descriptor.source} plugin: ${descriptor.id}`,
      );
    }
    if (catalog.has(descriptor.id)) throw new Error(`Duplicate plugin id: ${descriptor.id}`);
    catalog.set(descriptor.id, { ...registration, descriptor });
  }
  return catalog;
}

export function mergePluginCatalogs(
  builtin: ReadonlyMap<string, BuiltinPluginRegistration>,
  team: readonly BuiltinPluginRegistration[],
): ReadonlyMap<string, BuiltinPluginRegistration> {
  const catalog = new Map(builtin);
  for (const registration of team) {
    const descriptor = normalizePluginDescriptor(registration.descriptor);
    if (descriptor.source !== 'team') {
      throw new Error(`Team catalog cannot contain ${descriptor.source} plugin: ${descriptor.id}`);
    }
    if (catalog.has(descriptor.id)) throw new Error(`Duplicate plugin id: ${descriptor.id}`);
    catalog.set(descriptor.id, { ...registration, descriptor });
  }
  return catalog;
}
