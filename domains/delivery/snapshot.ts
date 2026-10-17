import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliverySnapshot,
  PublicationAction,
} from './types.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Digest(value: string): string {
  return `sha256:${sha256(value)}`;
}

export function deliveryPolicyDigest(policy: DeliveryPolicy): string {
  return sha256Digest(canonicalJson(policy));
}

export function normalizeDeliveryIntent(intent: DeliveryIntent): DeliveryIntent {
  return {
    ...intent,
    repositories: [...intent.repositories].sort((left, right) =>
      left.repositoryId.localeCompare(right.repositoryId),
    ),
  };
}

export function deliveryIntentDigest(intent: DeliveryIntent): string {
  return sha256Digest(canonicalJson(normalizeDeliveryIntent(intent)));
}

export function createPublicationPlan(
  intent: DeliveryIntent,
  facts: readonly DeliveryRepositoryFacts[],
): PublicationAction[] {
  const byId = new Map(facts.map((item) => [item.repositoryId, item]));
  const actions: PublicationAction[] = [];
  for (const selected of [...intent.repositories].sort((a, b) =>
    a.repositoryId.localeCompare(b.repositoryId),
  )) {
    const repository = byId.get(selected.repositoryId);
    if (!repository) throw new Error(`Selected repository is missing: ${selected.repositoryId}`);
    for (const requested of [...selected.actions].sort((left, right) =>
      left === 'push' ? -1 : right === 'push' ? 1 : 0,
    )) {
      if (requested !== 'push' && requested !== 'merge_request')
        throw new Error(`Unsupported delivery action: ${String(requested)}`);
      const type = requested === 'push' ? 'git.push' : 'mr.create_or_update';
      const identity = [
        intent.changeId,
        selected.repositoryId,
        type,
        selected.sourceBranch,
        selected.targetBranch,
      ].join('\0');
      actions.push({
        actionId: sha256(identity).slice(0, 24),
        type,
        repositoryId: selected.repositoryId,
        sourceBranch: selected.sourceBranch,
        targetBranch: selected.targetBranch,
        expectedHead: repository.head,
        expectedRemoteSourceOid: repository.remoteSourceOid,
        expectedRemoteTargetOid: repository.remoteTargetOid,
      });
    }
  }
  return actions;
}

export function createDeliverySnapshot(options: {
  intent: DeliveryIntent;
  policy: DeliveryPolicy;
  reportContents: string;
  repositories: DeliveryRepositoryFacts[];
  createdAt: string;
}): DeliverySnapshot {
  const repositories = [...options.repositories].sort((a, b) =>
    a.repositoryId.localeCompare(b.repositoryId),
  );
  if (repositories.some((repository) => !repository.clean))
    throw new Error('All selected repositories must be clean before approval');
  const normalizedIntent = normalizeDeliveryIntent(options.intent);
  const plan = createPublicationPlan(normalizedIntent, repositories);
  const reportDigest = sha256Digest(options.reportContents);
  const policyDigest = deliveryPolicyDigest(options.policy);
  const intentDigest = deliveryIntentDigest(normalizedIntent);
  const stable = {
    schemaVersion: 1 as const,
    changeId: options.intent.changeId,
    reportDigest,
    policyDigest,
    intentDigest,
    repositories,
    plan,
  };
  return { ...stable, digest: sha256Digest(canonicalJson(stable)), createdAt: options.createdAt };
}

export function compareDeliverySnapshots(
  expected: DeliverySnapshot,
  current: DeliverySnapshot,
): string[] {
  const fields: Array<
    keyof Pick<DeliverySnapshot, 'changeId' | 'reportDigest' | 'policyDigest' | 'intentDigest'>
  > = ['changeId', 'reportDigest', 'policyDigest', 'intentDigest'];
  const drift: string[] = fields.filter((field) => expected[field] !== current[field]);
  if (canonicalJson(expected.repositories) !== canonicalJson(current.repositories))
    drift.push('repositories');
  if (canonicalJson(expected.plan) !== canonicalJson(current.plan)) drift.push('plan');
  return drift;
}
