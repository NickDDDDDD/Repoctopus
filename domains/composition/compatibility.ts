import type {
  CompositionCompatibility,
  CompositionIdentitySnapshot,
  PluginImplementationIdentity,
} from './types.js';

const PROTECTED_AUTHORITIES = new Set([
  'action-store-write',
  'delivery-state-write',
  'evidence-gate',
  'lifecycle-definition',
  'lifecycle-definition-registry',
  'lifecycle-extension',
  'lifecycle-extension-registry',
  'lifecycle-validator',
  'lifecycle-validator-registry',
  'run-store-write',
  'specification-authority',
  'workflow-transition',
]);

function protectsDurableSemantics(plugin: PluginImplementationIdentity): boolean {
  return plugin.authorities.some(
    (authority) => PROTECTED_AUTHORITIES.has(authority) || authority.startsWith('action-adapter:'),
  );
}

function sameRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function explicitlyAccepts(
  previous: PluginImplementationIdentity,
  current: PluginImplementationIdentity,
): boolean {
  const predecessors = current.compatibleImplementations ?? [];
  return (
    predecessors.length === 1 &&
    predecessors[0]?.codeDigest === previous.codeDigest &&
    predecessors[0].descriptorDigest === previous.descriptorDigest
  );
}

export function compareCompositions(
  previous: CompositionIdentitySnapshot,
  current: CompositionIdentitySnapshot,
  dependencyClosure?: {
    pluginIds: readonly string[];
    authorities: readonly string[];
  },
): CompositionCompatibility {
  if (previous.compositionDigest === current.compositionDigest) {
    return { status: 'same', changedPluginIds: [], reason: 'composition digest is unchanged' };
  }

  const previousById = new Map(previous.plugins.map((plugin) => [plugin.id, plugin]));
  const currentById = new Map(current.plugins.map((plugin) => [plugin.id, plugin]));
  const allChangedPluginIds = [...new Set([...previousById.keys(), ...currentById.keys()])]
    .filter((id) => {
      const before = previousById.get(id);
      const after = currentById.get(id);
      return (
        !before ||
        !after ||
        before.descriptorDigest !== after.descriptorDigest ||
        before.configDigest !== after.configDigest ||
        before.codeDigest !== after.codeDigest
      );
    })
    .sort();
  const requiredPluginIds = new Set(dependencyClosure?.pluginIds ?? []);
  const requiredAuthorities = new Set(dependencyClosure?.authorities ?? []);
  const changedPluginIds = dependencyClosure
    ? allChangedPluginIds.filter((id) => {
        const before = previousById.get(id);
        const after = currentById.get(id);
        return (
          requiredPluginIds.has(id) ||
          [...(before?.authorities ?? []), ...(after?.authorities ?? [])].some((authority) =>
            requiredAuthorities.has(authority),
          )
        );
      })
    : allChangedPluginIds;

  for (const id of changedPluginIds) {
    const before = previousById.get(id);
    const after = currentById.get(id);
    if (!before || !after) {
      const identity = before ?? after!;
      if (protectsDurableSemantics(identity) || Object.keys(identity.stateSchemas).length > 0) {
        return {
          status: 'migration_required',
          changedPluginIds,
          reason: `stateful or protected plugin ${id} was ${before ? 'removed' : 'added'}`,
        };
      }
      continue;
    }
    const contractChanged =
      !sameRecord(before.stateSchemas, after.stateSchemas) ||
      JSON.stringify(before.authorities) !== JSON.stringify(after.authorities) ||
      before.configDigest !== after.configDigest;
    const protectedChange = protectsDurableSemantics(before) || protectsDurableSemantics(after);
    if (contractChanged || (protectedChange && !explicitlyAccepts(before, after))) {
      return {
        status: 'migration_required',
        changedPluginIds,
        reason: contractChanged
          ? `plugin ${id} changed its state, authority, or configuration contract`
          : `protected plugin ${id} changed without an exact implementation compatibility declaration`,
      };
    }
  }

  return {
    status: 'compatible',
    changedPluginIds,
    reason:
      'changed implementations are stateless or carry an exact predecessor declaration without contract drift',
  };
}
