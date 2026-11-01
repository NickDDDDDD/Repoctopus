import {
  IDENTITY_DEPENDENCIES,
  RUNTIME_IDENTITY_KINDS,
  type RuntimeIdentityKind,
} from './identity.js';

export interface RuntimeInvalidationScope {
  retainedIdentities: RuntimeIdentityKind[];
  invalidatedIdentities: RuntimeIdentityKind[];
}

function dependentsOf(changed: ReadonlySet<RuntimeIdentityKind>): Set<RuntimeIdentityKind> {
  const invalidated = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [kind, dependencies] of Object.entries(IDENTITY_DEPENDENCIES) as Array<
      [RuntimeIdentityKind, readonly RuntimeIdentityKind[]]
    >) {
      if (
        !invalidated.has(kind) &&
        dependencies.some((dependency) => invalidated.has(dependency))
      ) {
        invalidated.add(kind);
        grew = true;
      }
    }
  }
  return invalidated;
}

/**
 * Returns the fixed dependency closure used by guarded lifecycle reducers.
 * Classification and successor selection remain explicit at each transition;
 * this helper is deliberately not a second, detached transition planner.
 */
export function runtimeInvalidationScope(
  changedIdentities: readonly RuntimeIdentityKind[],
): RuntimeInvalidationScope {
  const invalidated = dependentsOf(new Set(changedIdentities));
  return {
    retainedIdentities: RUNTIME_IDENTITY_KINDS.filter((kind) => !invalidated.has(kind)).sort(),
    invalidatedIdentities: RUNTIME_IDENTITY_KINDS.filter((kind) => invalidated.has(kind)).sort(),
  };
}
