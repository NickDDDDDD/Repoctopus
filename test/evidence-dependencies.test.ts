import { describe, expect, it } from 'vitest';

import {
  createEvidenceDependencyRecord,
  evidencePartitionFingerprints,
  invalidateEvidenceDependencies,
  type EvidenceDependency,
} from '../domains/evidence/dependencies.js';

describe('Evidence dependency partitions', () => {
  const inputs: EvidenceDependency[] = [
    { partition: 'implementation-content', identity: 'tree:app' },
    { partition: 'planning-semantic', identity: 'planning:1' },
    { partition: 'execution-control', identity: 'profile:verify' },
    { partition: 'git-identity', identity: 'commit:app' },
    { partition: 'publication-provenance', identity: 'spec-mr:1' },
  ];

  it('fingerprints product, planning, control, optional Git, and publication inputs independently', () => {
    const baseline = evidencePartitionFingerprints(inputs);
    for (const dependency of inputs) {
      const changed = inputs.map((entry) =>
        entry === dependency ? { ...entry, identity: `${entry.identity}:changed` } : entry,
      );
      const next = evidencePartitionFingerprints(changed);
      expect(next[dependency.partition]).not.toBe(baseline[dependency.partition]);
      for (const other of inputs.filter((entry) => entry.partition !== dependency.partition)) {
        expect(next[other.partition]).toBe(baseline[other.partition]);
      }
    }
  });

  it('round-trips normalized dependencies for every protected Evidence fact', () => {
    for (const subjectKind of [
      'receipt',
      'bundle',
      'gate',
      'build-check',
      'verification-input',
    ] as const) {
      const record = createEvidenceDependencyRecord({
        subjectKind,
        subjectId: `${subjectKind}:1`,
        dependencies: [...inputs].reverse(),
      });
      expect(JSON.parse(JSON.stringify(record))).toEqual(record);
      expect(record.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });

  it('invalidates only the declared downstream closure and separates provider unavailability', () => {
    const receipt = createEvidenceDependencyRecord({
      subjectKind: 'receipt',
      subjectId: 'receipt:unit',
      dependencies: [{ partition: 'implementation-content', identity: 'tree:app' }],
    });
    const unrelated = createEvidenceDependencyRecord({
      subjectKind: 'receipt',
      subjectId: 'receipt:docs',
      dependencies: [{ partition: 'implementation-content', identity: 'tree:docs' }],
    });
    const bundle = createEvidenceDependencyRecord({
      subjectKind: 'bundle',
      subjectId: 'bundle:verify',
      dependencies: [],
      dependsOnEvidenceIds: ['receipt:unit', 'receipt:docs'],
    });
    expect(
      invalidateEvidenceDependencies({
        records: [bundle, unrelated, receipt],
        changedDependencies: [{ partition: 'implementation-content', identity: 'tree:app' }],
        providerAvailable: true,
      }),
    ).toEqual({
      action: 'invalidate-evidence',
      invalidatedEvidenceIds: ['bundle:verify', 'receipt:unit'],
      retainedEvidenceIds: ['receipt:docs'],
    });
    expect(
      invalidateEvidenceDependencies({
        records: [receipt],
        changedDependencies: inputs,
        providerAvailable: false,
      }),
    ).toEqual({
      action: 'retry-infrastructure',
      invalidatedEvidenceIds: [],
      retainedEvidenceIds: ['receipt:unit'],
    });
  });
});
