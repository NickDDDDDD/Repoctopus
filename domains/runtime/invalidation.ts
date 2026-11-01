import {
  IDENTITY_DEPENDENCIES,
  RUNTIME_IDENTITY_KINDS,
  runtimeIdentityEntries,
  type RuntimeIdentityBasis,
  type RuntimeIdentityKind,
} from './identity.js';

export type RuntimeInvalidationClassification =
  | 'semantic'
  | 'approval-authority'
  | 'composition'
  | 'build-input'
  | 'verification-input'
  | 'publication'
  | 'unknown';

export interface RuntimeInvalidationPlan {
  schemaVersion: 1;
  classification: RuntimeInvalidationClassification;
  disposition: 'continue' | 'reconcile' | 'invalidate' | 'migration_required';
  scope: 'none' | 'exact' | 'conservative';
  reasonCode: string;
  retainedIdentities: RuntimeIdentityKind[];
  invalidatedIdentities: RuntimeIdentityKind[];
  successor:
    | 'continue'
    | 'reconcile'
    | 'design'
    | 'configure'
    | 'plan'
    | 'verify'
    | 'migration_required'
    | 'human-decision';
}

const PRIORITY: RuntimeIdentityKind[] = [
  'planning-semantic',
  'validation-observation',
  'approval-authority',
  'composition',
  'build-configuration',
  'build-plan',
  'verification-input',
  'execution-checkpoint',
  'publication-provenance',
];

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

export function runtimeInvalidationScope(
  changedIdentities: readonly RuntimeIdentityKind[],
): Pick<RuntimeInvalidationPlan, 'retainedIdentities' | 'invalidatedIdentities'> {
  const invalidated = dependentsOf(new Set(changedIdentities));
  return {
    retainedIdentities: RUNTIME_IDENTITY_KINDS.filter((kind) => !invalidated.has(kind)).sort(),
    invalidatedIdentities: RUNTIME_IDENTITY_KINDS.filter((kind) => invalidated.has(kind)).sort(),
  };
}

function decision(
  kind: RuntimeIdentityKind,
): Pick<RuntimeInvalidationPlan, 'classification' | 'disposition' | 'reasonCode' | 'successor'> {
  switch (kind) {
    case 'planning-semantic':
      return {
        classification: 'semantic',
        disposition: 'invalidate',
        reasonCode: 'semantic-drift',
        successor: 'design',
      };
    case 'validation-observation':
      return {
        classification: 'semantic',
        disposition: 'invalidate',
        reasonCode: 'validation-observation-drift',
        successor: 'design',
      };
    case 'approval-authority':
      return {
        classification: 'approval-authority',
        disposition: 'invalidate',
        reasonCode: 'approval-authority-drift',
        successor: 'design',
      };
    case 'composition':
      return {
        classification: 'composition',
        disposition: 'migration_required',
        reasonCode: 'composition-adoption-required',
        successor: 'migration_required',
      };
    case 'build-configuration':
      return {
        classification: 'build-input',
        disposition: 'invalidate',
        reasonCode: 'build-configuration-drift',
        successor: 'configure',
      };
    case 'build-plan':
    case 'execution-checkpoint':
      return {
        classification: 'build-input',
        disposition: 'invalidate',
        reasonCode: kind === 'build-plan' ? 'build-plan-drift' : 'execution-checkpoint-drift',
        successor: 'plan',
      };
    case 'verification-input':
      return {
        classification: 'verification-input',
        disposition: 'invalidate',
        reasonCode: 'verification-input-drift',
        successor: 'verify',
      };
    case 'publication-provenance':
      return {
        classification: 'publication',
        disposition: 'reconcile',
        reasonCode: 'publication-drift',
        successor: 'reconcile',
      };
  }
}

export function planRuntimeInvalidation(input: {
  previous: RuntimeIdentityBasis;
  current: RuntimeIdentityBasis | null;
  observationStatus?: 'observed' | 'unknown';
}): RuntimeInvalidationPlan {
  if (input.observationStatus === 'unknown' || input.current === null) {
    return {
      schemaVersion: 1,
      classification: 'unknown',
      disposition: 'invalidate',
      scope: 'conservative',
      reasonCode: 'identity-observation-unknown',
      retainedIdentities: [],
      invalidatedIdentities: runtimeIdentityEntries(input.previous).map(([kind]) => kind),
      successor: 'human-decision',
    };
  }

  const previous = new Map(runtimeIdentityEntries(input.previous));
  const current = new Map(runtimeIdentityEntries(input.current));
  const changed = new Set<RuntimeIdentityKind>();
  for (const kind of new Set([...previous.keys(), ...current.keys()])) {
    if (previous.get(kind)?.digest !== current.get(kind)?.digest) changed.add(kind);
  }
  if (changed.size === 0) {
    return {
      schemaVersion: 1,
      classification: 'publication',
      disposition: 'continue',
      scope: 'none',
      reasonCode: 'identities-unchanged',
      retainedIdentities: [...current.keys()].sort(),
      invalidatedIdentities: [],
      successor: 'continue',
    };
  }
  const primary = PRIORITY.find((kind) => changed.has(kind))!;
  const invalidated = dependentsOf(changed);
  const chosen = decision(primary);
  return {
    schemaVersion: 1,
    ...chosen,
    scope: 'exact',
    retainedIdentities: [...current.keys()].filter((kind) => !invalidated.has(kind)).sort(),
    invalidatedIdentities: [...invalidated].filter((kind) => current.has(kind)).sort(),
  };
}
