import { describe, expect, it } from 'vitest';

import {
  assertSpecificationClosureCandidate,
  decideSpecificationClosureRecovery,
  type SpecificationClosureCandidateObservation,
} from '../domains/specification/closure-candidate.js';
import {
  advanceSpecificationClosureJournal,
  createSpecificationClosureJournal,
  recordSpecificationClosureExpectedManifest,
} from '../domains/specification/closure-journal.js';
import type {
  SpecificationClosurePlan,
  SpecificationClosureResult,
} from '../domains/specification/types.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const before = [
  {
    path: 'openspec/changes/candidate/proposal.md',
    kind: 'file' as const,
    contentDigest: digest('1'),
  },
];
const expected = [
  {
    path: 'openspec/changes/archive/2026-10-24-candidate/proposal.md',
    kind: 'file' as const,
    contentDigest: digest('1'),
  },
  { path: 'openspec/specs/archive/spec.md', kind: 'file' as const, contentDigest: digest('2') },
];
const plan: SpecificationClosurePlan = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationClosurePlan',
  changeId: 'candidate',
  provider: {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  },
  changeDigest: digest('3'),
  mergeFactsDigest: digest('4'),
  targetBaselineDigest: digest('5'),
  affectedCapabilities: ['archive'],
  retiredCapabilities: [],
  allowedPathPrefixes: ['openspec/changes', 'openspec/specs/archive'],
  planDigest: digest('6'),
};
const prepared = createSpecificationClosureJournal({
  changeId: plan.changeId,
  checkoutId: 'checkout-candidate',
  plan,
  before,
  expectedArchiveId: '2026-10-24-candidate',
});
const applying = advanceSpecificationClosureJournal(prepared, 'applying');
const observed = recordSpecificationClosureExpectedManifest(applying, expected);
const result: SpecificationClosureResult = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationClosureResult',
  changeId: plan.changeId,
  provider: plan.provider,
  planDigest: plan.planDigest,
  closureId: digest('7'),
  status: 'closed',
  archiveId: '2026-10-24-candidate',
  changedFiles: [
    'openspec/changes/archive/2026-10-24-candidate/proposal.md',
    'openspec/changes/candidate/proposal.md',
    'openspec/specs/archive/spec.md',
  ],
  candidate: { checkoutId: 'checkout-candidate', baseOid: 'b'.repeat(40) },
};
const candidate: SpecificationClosureCandidateObservation = {
  changeId: plan.changeId,
  activeChangeExists: false,
  archiveIds: [result.archiveId],
  purposeCapabilities: ['archive'],
  validAffectedCapabilities: ['archive'],
  retiredCapabilities: [],
  strictStoreValid: true,
  changedFiles: [...result.changedFiles],
  manifest: expected,
};

describe('Specification closure candidate postconditions', () => {
  it('accepts the unique strict candidate and rejects every independent postcondition failure', () => {
    expect(() =>
      assertSpecificationClosureCandidate({ journal: prepared, result, observation: candidate }),
    ).not.toThrow();
    const failures: Array<[Partial<SpecificationClosureCandidateObservation>, RegExp]> = [
      [{ activeChangeExists: true }, /active Change/u],
      [{ archiveIds: [] }, /exactly one/u],
      [{ archiveIds: [result.archiveId, 'duplicate'] }, /exactly one/u],
      [{ purposeCapabilities: [] }, /missing Purpose/u],
      [{ validAffectedCapabilities: [] }, /invalid affected/u],
      [{ strictStoreValid: false }, /strict Store/u],
      [{ changedFiles: [...result.changedFiles, 'src/escape.ts'] }, /outside the plan/u],
    ];
    for (const [change, message] of failures) {
      expect(() =>
        assertSpecificationClosureCandidate({
          journal: prepared,
          result: change.changedFiles ? { ...result, changedFiles: change.changedFiles } : result,
          observation: { ...candidate, ...change },
        }),
      ).toThrow(message);
    }
  });

  it('uses file CAS to choose continuation, rollback, replay, or manual repair', () => {
    expect(
      decideSpecificationClosureRecovery({
        journal: prepared,
        current: before,
        candidateValid: false,
      }),
    ).toBe('continue-apply');
    expect(
      decideSpecificationClosureRecovery({
        journal: observed,
        current: expected,
        candidateValid: true,
      }),
    ).toBe('continue-commit');
    const rollingBack = advanceSpecificationClosureJournal(observed, 'rolling-back');
    expect(
      decideSpecificationClosureRecovery({
        journal: rollingBack,
        current: expected,
        candidateValid: false,
      }),
    ).toBe('continue-rollback');
    expect(
      decideSpecificationClosureRecovery({
        journal: rollingBack,
        current: before,
        candidateValid: false,
      }),
    ).toBe('complete-rollback');
    const committed = advanceSpecificationClosureJournal(observed, 'committed', {
      expected,
      resultClosureId: result.closureId,
    });
    expect(
      decideSpecificationClosureRecovery({
        journal: committed,
        current: expected,
        candidateValid: true,
      }),
    ).toBe('return-committed');
    expect(
      decideSpecificationClosureRecovery({
        journal: committed,
        current: [{ ...expected[0]!, contentDigest: digest('9') }],
        candidateValid: true,
      }),
    ).toBe('manual-repair');
  });
});
