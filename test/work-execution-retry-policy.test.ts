import { describe, expect, it } from 'vitest';

import {
  workExecutionChainIdentity,
  workExecutionRetryPolicy,
} from '../domains/work-execution/retry-policy.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

const work = {
  workId: 'build.execute:package-1',
  checkEpoch: 4,
  inputDigest: digest('1'),
  strategyId: 'strategy-1',
  bindingId: 'binding-1',
  planId: 'plan-1',
  planRevision: 2,
  packageId: 'package-1',
  taskId: '1.1',
  taskRevision: digest('2'),
  sideEffectClass: 'repository-write',
} satisfies Pick<
  WorkDescriptor,
  | 'workId'
  | 'checkEpoch'
  | 'inputDigest'
  | 'strategyId'
  | 'bindingId'
  | 'planId'
  | 'planRevision'
  | 'packageId'
  | 'taskId'
  | 'taskRevision'
  | 'sideEffectClass'
>;

describe('Work execution retry policy', () => {
  it('binds continue-build lineage to epoch, input, Plan, and retry policy', () => {
    const identity = workExecutionChainIdentity(work);

    expect(workExecutionChainIdentity({ ...work })).toBe(identity);
    expect(workExecutionChainIdentity({ ...work, checkEpoch: work.checkEpoch + 1 })).not.toBe(
      identity,
    );
    expect(workExecutionChainIdentity({ ...work, inputDigest: digest('3') })).not.toBe(identity);
    expect(workExecutionChainIdentity({ ...work, planRevision: work.planRevision + 1 })).not.toBe(
      identity,
    );
    expect(workExecutionChainIdentity({ ...work, sideEffectClass: 'platform-mutation' })).not.toBe(
      identity,
    );
  });

  it('requires reconciliation for external effects and permits bounded local continuation', () => {
    expect(workExecutionRetryPolicy(work)).toBe('idempotent');
    expect(workExecutionRetryPolicy({ sideEffectClass: 'process' })).toBe('idempotent');
    expect(workExecutionRetryPolicy({ sideEffectClass: 'git-publish' })).toBe('reconcile');
    expect(workExecutionRetryPolicy({ sideEffectClass: 'platform-mutation' })).toBe('reconcile');
  });
});
