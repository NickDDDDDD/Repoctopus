import { createHash } from 'node:crypto';

import { canonicalJson, canonicalValue } from '../../domains/workflow-contract/canonical.js';
import type {
  CompositionIdentitySnapshot,
  PluginImplementationIdentity,
} from '../../domains/composition/types.js';
import { descriptorDigest } from './descriptor.js';
import type { BuiltinPluginRegistration, CompositionKind, PluginDescriptor } from './descriptor.js';

export interface CompositionPluginSelection {
  id: string;
  config?: unknown;
  identityConfig?: unknown;
}

export interface CompositionDefinition {
  id: string;
  kind: CompositionKind;
  plugins: readonly CompositionPluginSelection[];
  requiredServices?: readonly string[];
  configuration?: CompositionIdentitySnapshot['configuration'];
}

export interface CompiledPluginEntry {
  id: string;
  name: `cordis:${string}`;
  config?: unknown;
  identityConfig?: unknown;
  descriptor: PluginDescriptor;
}

export interface CompiledComposition {
  id: string;
  kind: CompositionKind;
  compositionDigest: `sha256:${string}`;
  requiredServices: readonly string[];
  entries: readonly CompiledPluginEntry[];
  configuration?: CompositionIdentitySnapshot['configuration'];
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function compositionIdentity(composition: CompiledComposition): CompositionIdentitySnapshot {
  const plugins: PluginImplementationIdentity[] = composition.entries.map(
    ({ descriptor, config, identityConfig }) => ({
      id: descriptor.id,
      version: descriptor.version,
      configDigest: digest(identityConfig ?? config ?? null),
      codeDigest: descriptor.codeDigest,
      descriptorDigest: descriptorDigest(descriptor),
      authorities: [...descriptor.authorities],
      stateSchemas: { ...descriptor.stateSchemas },
      ...(descriptor.compatibleImplementations
        ? { compatibleImplementations: structuredClone(descriptor.compatibleImplementations) }
        : {}),
    }),
  );
  return {
    id: composition.id,
    kind: composition.kind,
    compositionDigest: composition.compositionDigest,
    plugins,
    ...(composition.configuration
      ? { configuration: structuredClone(composition.configuration) }
      : {}),
  };
}

function normalizedSelection(selection: CompositionPluginSelection): CompositionPluginSelection {
  const id = selection.id.trim();
  if (!id) throw new Error('Composition contains an empty plugin id');
  return {
    id,
    ...(selection.config === undefined ? {} : { config: canonicalValue(selection.config) }),
    ...(selection.identityConfig === undefined
      ? {}
      : { identityConfig: canonicalValue(selection.identityConfig) }),
  };
}

function sortedUnique(values: readonly string[], field: string): string[] {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value)) throw new Error(`${field} contains an empty value`);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} contains duplicate values`);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

export function compileComposition(
  definition: CompositionDefinition,
  catalog: ReadonlyMap<string, BuiltinPluginRegistration>,
): CompiledComposition {
  const id = definition.id.trim();
  if (!id) throw new Error('Composition id is required');

  const selected = definition.plugins.map(normalizedSelection);
  const duplicate = selected.find(
    (selection, index) =>
      selected.findIndex((candidate) => candidate.id === selection.id) !== index,
  );
  if (duplicate) throw new Error(`Composition contains duplicate plugin: ${duplicate.id}`);

  const entries = selected
    .map((selection) => {
      const registration = catalog.get(selection.id);
      if (!registration) throw new Error(`Unknown plugin: ${selection.id}`);
      const { descriptor } = registration;
      if (!descriptor.compositions.includes(definition.kind)) {
        throw new Error(`Plugin ${descriptor.id} is not allowed in ${definition.kind} composition`);
      }
      const config =
        selection.config === undefined
          ? canonicalValue(registration.defaultConfig)
          : selection.config;
      return {
        id: descriptor.id,
        name: `cordis:${descriptor.id}` as const,
        ...(config === undefined ? {} : { config }),
        ...(selection.identityConfig === undefined
          ? {}
          : { identityConfig: selection.identityConfig }),
        descriptor,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const authorityOwners = new Map<string, string>();
  for (const entry of entries) {
    for (const authority of entry.descriptor.authorities) {
      const owner = authorityOwners.get(authority);
      if (owner) {
        throw new Error(
          `Authority ${authority} has multiple owners: ${[owner, entry.id].sort().join(', ')}`,
        );
      }
      authorityOwners.set(authority, entry.id);
    }
  }

  const requiredServices = sortedUnique(
    definition.requiredServices ?? [],
    'Composition requiredServices',
  );
  const identity = {
    id,
    kind: definition.kind,
    requiredServices,
    plugins: entries.map(({ descriptor, config, identityConfig }) => ({
      descriptor,
      ...(identityConfig === undefined
        ? config === undefined
          ? {}
          : { config }
        : { config: identityConfig }),
    })),
    ...(definition.configuration
      ? { configuration: canonicalValue(definition.configuration) }
      : {}),
  };
  const compositionDigest = `sha256:${createHash('sha256')
    .update(canonicalJson(identity))
    .digest('hex')}` as const;

  return {
    id,
    kind: definition.kind,
    compositionDigest,
    requiredServices,
    entries,
    ...(definition.configuration
      ? { configuration: structuredClone(definition.configuration) }
      : {}),
  };
}
