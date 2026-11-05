import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';

export type EvidenceDependencyPartition =
  | 'implementation-content'
  | 'planning-semantic'
  | 'execution-control'
  | 'git-identity'
  | 'publication-provenance';

export interface EvidenceDependency {
  partition: EvidenceDependencyPartition;
  identity: string;
}

export type EvidenceDependencySubjectKind =
  | 'receipt'
  | 'bundle'
  | 'gate'
  | 'build-check'
  | 'verification-input';

export interface EvidenceDependencyRecord {
  schemaVersion: 1;
  subjectKind: EvidenceDependencySubjectKind;
  subjectId: string;
  dependencies: readonly EvidenceDependency[];
  dependsOnEvidenceIds: readonly string[];
  digest: `sha256:${string}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createEvidenceDependencyRecord(input: {
  subjectKind: EvidenceDependencySubjectKind;
  subjectId: string;
  dependencies: readonly EvidenceDependency[];
  dependsOnEvidenceIds?: readonly string[];
}): EvidenceDependencyRecord {
  if (!input.subjectId.trim()) throw new Error('Evidence dependency subject identity is required');
  const dependencies = [...input.dependencies]
    .map((entry) => {
      if (!entry.identity.trim()) throw new Error('Evidence dependency identity is required');
      return { partition: entry.partition, identity: entry.identity };
    })
    .sort((left, right) =>
      `${left.partition}\0${left.identity}`.localeCompare(`${right.partition}\0${right.identity}`),
    );
  const keys = dependencies.map((entry) => `${entry.partition}\0${entry.identity}`);
  if (new Set(keys).size !== keys.length) throw new Error('Evidence dependencies are duplicated');
  const stable = {
    schemaVersion: 1 as const,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    dependencies,
    dependsOnEvidenceIds: [...new Set(input.dependsOnEvidenceIds ?? [])].sort(),
  };
  return Object.freeze({ ...stable, digest: sha256(stable) });
}

export function evidencePartitionFingerprints(
  dependencies: readonly EvidenceDependency[],
): Readonly<Record<EvidenceDependencyPartition, `sha256:${string}`>> {
  const partitions: EvidenceDependencyPartition[] = [
    'implementation-content',
    'planning-semantic',
    'execution-control',
    'git-identity',
    'publication-provenance',
  ];
  return Object.freeze(
    Object.fromEntries(
      partitions.map((partition) => [
        partition,
        sha256(
          dependencies
            .filter((entry) => entry.partition === partition)
            .map((entry) => entry.identity)
            .sort(),
        ),
      ]),
    ) as Record<EvidenceDependencyPartition, `sha256:${string}`>,
  );
}

export interface EvidenceInvalidationResult {
  action: 'invalidate-evidence' | 'retry-infrastructure' | 'none';
  invalidatedEvidenceIds: readonly string[];
  retainedEvidenceIds: readonly string[];
}

export function invalidateEvidenceDependencies(input: {
  records: readonly EvidenceDependencyRecord[];
  changedDependencies: readonly EvidenceDependency[];
  providerAvailable: boolean;
}): EvidenceInvalidationResult {
  if (!input.providerAvailable) {
    return {
      action: 'retry-infrastructure',
      invalidatedEvidenceIds: [],
      retainedEvidenceIds: input.records.map((entry) => entry.subjectId).sort(),
    };
  }
  const changed = new Set(
    input.changedDependencies.map((entry) => `${entry.partition}\0${entry.identity}`),
  );
  const invalidated = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of input.records) {
      if (invalidated.has(record.subjectId)) continue;
      const direct = record.dependencies.some((entry) =>
        changed.has(`${entry.partition}\0${entry.identity}`),
      );
      const downstream = record.dependsOnEvidenceIds.some((identity) => invalidated.has(identity));
      if (direct || downstream) {
        invalidated.add(record.subjectId);
        grew = true;
      }
    }
  }
  const all = input.records.map((entry) => entry.subjectId).sort();
  return {
    action: invalidated.size > 0 ? 'invalidate-evidence' : 'none',
    invalidatedEvidenceIds: [...invalidated].sort(),
    retainedEvidenceIds: all.filter((identity) => !invalidated.has(identity)),
  };
}
