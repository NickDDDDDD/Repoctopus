import { describe, expect, it } from 'vitest';

import {
  advanceSpecificationClosureJournal,
  assertSpecificationClosureJournal,
  createSpecificationClosureJournal,
} from '../domains/specification/closure-journal.js';
import type { SpecificationClosurePlan } from '../domains/specification/types.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const plan: SpecificationClosurePlan = {
  apiVersion: 'repoctopus.specification/v1alpha1',
  kind: 'SpecificationClosurePlan',
  changeId: 'journal-contract',
  provider: {
    id: 'openspec',
    version: '1.14.3',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  },
  changeDigest: digest('1'),
  mergeFactsDigest: digest('2'),
  targetBaselineDigest: digest('3'),
  affectedCapabilities: ['archive'],
  retiredCapabilities: [],
  allowedPathPrefixes: ['openspec/changes/journal-contract', 'openspec/specs/archive'],
  planDigest: digest('4'),
};

describe('Specification Closure Journal contract', () => {
  it('has a stable golden shape and monotonic state machine', () => {
    const prepared = createSpecificationClosureJournal({
      changeId: 'journal-contract',
      checkoutId: 'checkout-17',
      plan,
      expectedArchiveId: '2026-10-24-journal-contract',
      before: [
        { path: 'openspec/specs/archive/spec.md', kind: 'file', contentDigest: digest('5') },
        {
          path: 'openspec/changes/archive/2026-10-24-journal-contract',
          kind: 'missing',
          contentDigest: null,
        },
      ],
    });
    expect(prepared).toMatchObject({
      apiVersion: 'repoctopus.specification-closure/v1alpha1',
      kind: 'SpecificationClosureJournal',
      schemaVersion: 1,
      state: 'prepared',
      stateVersion: 1,
      postconditions: {
        activeChangeAbsent: true,
        exactlyOneArchive: true,
        strictStoreValidation: true,
      },
    });
    const applying = advanceSpecificationClosureJournal(prepared, 'applying');
    const committed = advanceSpecificationClosureJournal(applying, 'committed', {
      expected: [
        { path: 'openspec/specs/archive/spec.md', kind: 'file', contentDigest: digest('6') },
      ],
      resultClosureId: digest('7'),
    });
    expect(committed).toMatchObject({
      state: 'committed',
      stateVersion: 3,
      resultClosureId: digest('7'),
    });
    expect(advanceSpecificationClosureJournal(committed, 'committed')).toEqual(committed);
    expect(() => advanceSpecificationClosureJournal(committed, 'applying')).toThrow(/cannot move/u);
    expect(() => advanceSpecificationClosureJournal(applying, 'prepared')).toThrow(/cannot move/u);
  });

  it('rejects unknown versions, cross-Change plans, and paths outside the checkout', () => {
    expect(() =>
      createSpecificationClosureJournal({
        changeId: 'other-change',
        checkoutId: 'checkout-1',
        plan,
        expectedArchiveId: 'archive',
        before: [],
      }),
    ).toThrow(/another Change/u);
    expect(() =>
      createSpecificationClosureJournal({
        changeId: plan.changeId,
        checkoutId: 'checkout-1',
        plan,
        expectedArchiveId: 'archive',
        before: [{ path: '../outside', kind: 'file', contentDigest: digest('8') }],
      }),
    ).toThrow(/isolated checkout/u);
    const journal = createSpecificationClosureJournal({
      changeId: plan.changeId,
      checkoutId: 'checkout-1',
      plan,
      expectedArchiveId: 'archive',
      before: [],
    });
    expect(() =>
      assertSpecificationClosureJournal({ ...journal, schemaVersion: 2 } as never),
    ).toThrow(/Unsupported/u);
    expect(() =>
      assertSpecificationClosureJournal({
        ...journal,
        plan: { ...journal.plan, changeId: 'other-change' },
      }),
    ).toThrow(/cross-Change/u);
  });
});
