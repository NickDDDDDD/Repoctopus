import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';

export type RuntimeIdentityKind =
  | 'planning-semantic'
  | 'validation-observation'
  | 'approval-authority'
  | 'composition'
  | 'build-configuration'
  | 'build-plan'
  | 'execution-checkpoint'
  | 'verification-input'
  | 'publication-provenance';

export type RuntimeIdentityOwner =
  | 'specification-planning'
  | 'specification-validation'
  | 'human-decision'
  | 'cordis-composition'
  | 'build-configuration'
  | 'build-plan'
  | 'work-execution'
  | 'verification-authority'
  | 'delivery-adapter';

export interface RuntimeIdentity {
  schemaVersion: 1;
  kind: RuntimeIdentityKind;
  owner: RuntimeIdentityOwner;
  digest: `sha256:${string}`;
}

export const IDENTITY_OWNERS = {
  'planning-semantic': 'specification-planning',
  'validation-observation': 'specification-validation',
  'approval-authority': 'human-decision',
  composition: 'cordis-composition',
  'build-configuration': 'build-configuration',
  'build-plan': 'build-plan',
  'execution-checkpoint': 'work-execution',
  'verification-input': 'verification-authority',
  'publication-provenance': 'delivery-adapter',
} as const satisfies Record<RuntimeIdentityKind, RuntimeIdentityOwner>;

export const IDENTITY_DEPENDENCIES = {
  'planning-semantic': [],
  'validation-observation': ['planning-semantic'],
  'approval-authority': ['planning-semantic'],
  composition: [],
  'build-configuration': ['composition'],
  'build-plan': ['planning-semantic', 'build-configuration'],
  'execution-checkpoint': ['build-plan', 'composition'],
  'verification-input': ['planning-semantic', 'build-plan'],
  'publication-provenance': [],
} as const satisfies Record<RuntimeIdentityKind, readonly RuntimeIdentityKind[]>;

const BASIS_FIELDS = {
  planningSemantic: 'planning-semantic',
  validationObservation: 'validation-observation',
  approvalAuthority: 'approval-authority',
  composition: 'composition',
  buildConfiguration: 'build-configuration',
  buildPlan: 'build-plan',
  executionCheckpoint: 'execution-checkpoint',
  verificationInput: 'verification-input',
  publicationProvenance: 'publication-provenance',
} as const;

export type RuntimeIdentityField = keyof typeof BASIS_FIELDS;

export interface RuntimeIdentityBasis {
  schemaVersion: 1;
  planningSemantic?: RuntimeIdentity;
  validationObservation?: RuntimeIdentity;
  approvalAuthority?: RuntimeIdentity;
  composition?: RuntimeIdentity;
  buildConfiguration?: RuntimeIdentity;
  buildPlan?: RuntimeIdentity;
  executionCheckpoint?: RuntimeIdentity;
  verificationInput?: RuntimeIdentity;
  publicationProvenance?: RuntimeIdentity;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export function createRuntimeIdentity(
  kind: RuntimeIdentityKind,
  material: unknown,
): RuntimeIdentity {
  return Object.freeze({
    schemaVersion: 1,
    kind,
    owner: IDENTITY_OWNERS[kind],
    digest: `sha256:${createHash('sha256')
      .update(canonicalJson({ schemaVersion: 1, kind, material }))
      .digest('hex')}`,
  });
}

export function identityByKind(
  basis: RuntimeIdentityBasis,
  kind: RuntimeIdentityKind,
): RuntimeIdentity | undefined {
  const field = (
    Object.entries(BASIS_FIELDS) as Array<[RuntimeIdentityField, RuntimeIdentityKind]>
  ).find(([, candidate]) => candidate === kind)?.[0];
  return field ? basis[field] : undefined;
}

export function validateRuntimeIdentityBasis(basis: RuntimeIdentityBasis): void {
  if (basis.schemaVersion !== 1) throw new Error('Runtime identity basis schema is unsupported');
  const allowed = new Set(['schemaVersion', ...Object.keys(BASIS_FIELDS)]);
  const unknown = Object.keys(basis).find((field) => !allowed.has(field));
  if (unknown)
    throw new Error(`Runtime identity basis contains unknown identity field: ${unknown}`);

  for (const [field, expectedKind] of Object.entries(BASIS_FIELDS) as Array<
    [RuntimeIdentityField, RuntimeIdentityKind]
  >) {
    const identity = basis[field];
    if (!identity) continue;
    if (identity.schemaVersion !== 1 || identity.kind !== expectedKind) {
      throw new Error(`Runtime identity ${field} has the wrong kind`);
    }
    if (identity.owner !== IDENTITY_OWNERS[expectedKind]) {
      throw new Error(`Runtime identity ${expectedKind} has the wrong owner`);
    }
    if (!SHA256.test(identity.digest)) {
      throw new Error(`Runtime identity ${expectedKind} must use a SHA-256 digest`);
    }
    for (const dependency of IDENTITY_DEPENDENCIES[expectedKind]) {
      if (!identityByKind(basis, dependency)) {
        throw new Error(`Runtime identity ${expectedKind} requires ${dependency}`);
      }
    }
  }
}

export function runtimeIdentityEntries(
  basis: RuntimeIdentityBasis,
): Array<readonly [RuntimeIdentityKind, RuntimeIdentity]> {
  return (Object.entries(BASIS_FIELDS) as Array<[RuntimeIdentityField, RuntimeIdentityKind]>)
    .flatMap(([field, kind]) => {
      const identity = basis[field];
      return identity ? [[kind, identity] as const] : [];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}
