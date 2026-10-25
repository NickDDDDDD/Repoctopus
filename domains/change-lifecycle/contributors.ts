import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangeLifecycleDefinition, WorkDescriptor } from './transition.js';
import type { LifecycleWriteScopeDefinition, WorkSideEffectClass } from './transition.js';

export type LifecycleContributorKind = 'definition' | 'work' | 'validator' | 'extension';

export interface LifecycleContributorIdentity {
  schemaVersion: 1;
  kind: LifecycleContributorKind;
  id: string;
  version: string;
  codeDigest: `sha256:${string}`;
  configDigest: `sha256:${string}`;
  compatibleWith: readonly string[];
}

export interface LifecycleDefinitionContributor {
  identity: LifecycleContributorIdentity & { kind: 'definition' };
  definition: ChangeLifecycleDefinition;
}

export interface LifecycleValidatorContributor {
  identity: LifecycleContributorIdentity & { kind: 'validator' };
  profiles: readonly string[];
  validate(input: {
    profileId: string;
    work: WorkDescriptor;
    fact: unknown;
  }): Promise<{ accepted: boolean; diagnostic: string }>;
}

export interface LifecycleExtensionContributor {
  identity: LifecycleContributorIdentity & { kind: 'extension' };
  declaredCapabilities: readonly string[];
  declaredWriteScopes: readonly LifecycleWriteScopeDefinition[];
  works: readonly {
    kind: string;
    checkpoint: string;
    capabilities: readonly string[];
    sideEffectClass: WorkSideEffectClass;
    writeScopes: readonly LifecycleWriteScopeDefinition[];
  }[];
  validations: readonly {
    profileId: string;
    checkpoint: string;
    required: boolean;
  }[];
  requestedTransitions?: readonly unknown[];
  bypass?: {
    designApproval?: boolean;
    verifyGate?: boolean;
    archiveCompletion?: boolean;
  };
}

export interface LifecycleContributorSnapshot {
  schemaVersion: 1;
  contributors: readonly LifecycleContributorIdentity[];
  digest: `sha256:${string}`;
}

export interface LifecycleContributorCompatibility {
  status: 'same' | 'compatible' | 'migration_required';
  changedContributorIds: string[];
  reason: string;
}

export function lifecycleContributorIdentity<K extends LifecycleContributorKind>(
  input: Omit<LifecycleContributorIdentity, 'schemaVersion' | 'kind' | 'compatibleWith'> & {
    kind: K;
    compatibleWith?: readonly string[];
  },
): LifecycleContributorIdentity & { kind: K } {
  const identity = {
    schemaVersion: 1 as const,
    ...input,
    id: input.id.trim(),
    version: input.version.trim(),
    compatibleWith: [...new Set(input.compatibleWith ?? [])].sort(),
  };
  if (
    !identity.id ||
    !identity.version ||
    !/^sha256:[a-f0-9]{64}$/u.test(identity.codeDigest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(identity.configDigest)
  ) {
    throw new Error(`Invalid ${identity.kind} lifecycle Contributor identity`);
  }
  return identity;
}

export function compareLifecycleContributorSnapshots(
  previous: LifecycleContributorSnapshot,
  current: LifecycleContributorSnapshot,
): LifecycleContributorCompatibility {
  if (previous.digest === current.digest) {
    return { status: 'same', changedContributorIds: [], reason: 'Contributor digest is unchanged' };
  }
  const before = new Map(
    previous.contributors.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
  );
  const after = new Map(current.contributors.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  const changedContributorIds = [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => canonicalJson(before.get(key)) !== canonicalJson(after.get(key)))
    .sort();
  for (const key of changedContributorIds) {
    const oldIdentity = before.get(key);
    const newIdentity = after.get(key);
    if (!oldIdentity || !newIdentity) {
      return {
        status: 'migration_required',
        changedContributorIds,
        reason: `Lifecycle Contributor ${key} was ${oldIdentity ? 'removed' : 'added'}`,
      };
    }
    if (!newIdentity.compatibleWith.includes(oldIdentity.version)) {
      return {
        status: 'migration_required',
        changedContributorIds,
        reason: `Lifecycle Contributor ${key} changed without a compatibility declaration`,
      };
    }
  }
  return {
    status: 'compatible',
    changedContributorIds,
    reason: 'All changed lifecycle Contributors declare backward compatibility',
  };
}

export function lifecycleContributorSnapshot(
  contributors: readonly LifecycleContributorIdentity[],
): LifecycleContributorSnapshot {
  const normalized = contributors
    .map((entry) => structuredClone(entry))
    .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  const keys = normalized.map((entry) => `${entry.kind}:${entry.id}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Lifecycle Contributor snapshot contains duplicate identities');
  }
  return {
    schemaVersion: 1,
    contributors: normalized,
    digest: `sha256:${createHash('sha256').update(canonicalJson(normalized)).digest('hex')}`,
  };
}

function scopeKey(scope: LifecycleWriteScopeDefinition): string {
  return canonicalJson({
    repositorySelector: scope.repositorySelector,
    paths: [...scope.paths].sort(),
    operations: [...scope.operations].sort(),
  });
}

export function lifecycleExtensionFindings(
  extension: LifecycleExtensionContributor,
  definition: ChangeLifecycleDefinition,
): string[] {
  const findings: string[] = [];
  const checkpoints = new Set(definition.phases.flatMap((phase) => phase.extensionCheckpoints));
  const coreWorkKinds = new Set(definition.works.map((work) => work.kind));
  const capabilities = new Set(extension.declaredCapabilities);
  const writeScopes = new Set(extension.declaredWriteScopes.map(scopeKey));
  if ((extension.requestedTransitions?.length ?? 0) > 0) findings.push('core-transition-requested');
  if (
    extension.bypass?.designApproval ||
    extension.bypass?.verifyGate ||
    extension.bypass?.archiveCompletion
  ) {
    findings.push('protected-gate-bypass-requested');
  }
  for (const work of extension.works) {
    if (!checkpoints.has(work.checkpoint))
      findings.push(`undeclared-checkpoint:${work.checkpoint}`);
    if (!work.kind.trim() || coreWorkKinds.has(work.kind)) {
      findings.push(`core-or-invalid-work-kind:${work.kind}`);
    }
    if (work.capabilities.some((capability) => !capabilities.has(capability))) {
      findings.push(`undeclared-capability:${work.kind}`);
    }
    if (work.writeScopes.some((scope) => !writeScopes.has(scopeKey(scope)))) {
      findings.push(`undeclared-write-scope:${work.kind}`);
    }
    if (
      work.sideEffectClass === 'specification-write' ||
      work.capabilities.includes('specification.write')
    ) {
      findings.push(`premature-specification-archive:${work.kind}`);
    }
  }
  for (const validation of extension.validations) {
    if (!checkpoints.has(validation.checkpoint)) {
      findings.push(`undeclared-checkpoint:${validation.checkpoint}`);
    }
    if (!validation.profileId.trim()) findings.push('invalid-validator-profile');
    if (!validation.required)
      findings.push(`optional-authoritative-validation:${validation.profileId}`);
  }
  return [...new Set(findings)].sort();
}

export function assertSafeLifecycleExtension(
  extension: LifecycleExtensionContributor,
  definition: ChangeLifecycleDefinition,
): void {
  const findings = lifecycleExtensionFindings(extension, definition);
  if (findings.length > 0) {
    throw new Error(`Unsafe Lifecycle Extension ${extension.identity.id}: ${findings.join(', ')}`);
  }
}
