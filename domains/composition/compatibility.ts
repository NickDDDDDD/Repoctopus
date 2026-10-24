import type {
  CompositionCompatibility,
  CompositionIdentitySnapshot,
  PluginImplementationIdentity,
} from './types.js';

const PROTECTED_AUTHORITIES = new Set([
  'action-store-write',
  'change-lifecycle-migration',
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

export function compareCompositions(
  previous: CompositionIdentitySnapshot,
  current: CompositionIdentitySnapshot,
): CompositionCompatibility {
  if (previous.compositionDigest === current.compositionDigest) {
    return { status: 'same', changedPluginIds: [], reason: 'composition digest is unchanged' };
  }

  const previousById = new Map(previous.plugins.map((plugin) => [plugin.id, plugin]));
  const currentById = new Map(current.plugins.map((plugin) => [plugin.id, plugin]));
  const changedPluginIds = [...new Set([...previousById.keys(), ...currentById.keys()])]
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
    if (
      protectsDurableSemantics(before) ||
      protectsDurableSemantics(after) ||
      !sameRecord(before.stateSchemas, after.stateSchemas) ||
      JSON.stringify(before.authorities) !== JSON.stringify(after.authorities)
    ) {
      return {
        status: 'migration_required',
        changedPluginIds,
        reason: `plugin ${id} owns protected behavior or changed its state contract`,
      };
    }
  }

  return {
    status: 'compatible',
    changedPluginIds,
    reason: 'only stateless, non-protected plugin implementations changed',
  };
}
