import { createHash } from 'node:crypto';

import type { WorkDescriptor } from '../change-lifecycle/transition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export type WorkExecutionRetryPolicy = 'idempotent' | 'reconcile';

export function workExecutionRetryPolicy(
  work: Pick<WorkDescriptor, 'sideEffectClass'>,
): WorkExecutionRetryPolicy {
  return ['git-publish', 'platform-mutation'].includes(work.sideEffectClass)
    ? 'reconcile'
    : 'idempotent';
}

export function workExecutionChainIdentity(
  work: Pick<
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
  >,
): `execution-chain:sha256:${string}` {
  const material = {
    workId: work.workId,
    checkEpoch: work.checkEpoch,
    inputDigest: work.inputDigest,
    strategyId: work.strategyId ?? null,
    bindingId: work.bindingId ?? null,
    planId: work.planId ?? null,
    planRevision: work.planRevision ?? null,
    packageId: work.packageId ?? null,
    taskId: work.taskId ?? null,
    taskRevision: work.taskRevision ?? null,
    sideEffectClass: work.sideEffectClass,
  };
  return `execution-chain:sha256:${createHash('sha256')
    .update(canonicalJson(material))
    .digest('hex')}`;
}
