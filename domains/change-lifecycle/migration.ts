import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';

export type LegacyLifecycleKind =
  | 'generic-run'
  | 'planning-approval'
  | 'delivery-v2'
  | 'delivery-v3'
  | 'post-merge-run';

export interface LegacyLifecycleRecord {
  id: string;
  kind: LegacyLifecycleKind;
  authority: string;
  identity: Readonly<Record<string, string>>;
  inputs: readonly string[];
  nextAction: string;
  externalSideEffects: readonly string[];
  state: Readonly<Record<string, unknown>>;
}

export type ChangeLifecycleMigrationStatus =
  | 'migratable'
  | 'completed_history'
  | 'manual_decision_required'
  | 'migration_required';

export interface ChangeLifecycleMigrationPlan {
  schemaVersion: 1;
  kind: 'ChangeLifecycleMigrationPlan';
  fixtureId: string;
  legacyKind: LegacyLifecycleKind;
  legacyIdentity: Readonly<Record<string, string>>;
  status: ChangeLifecycleMigrationStatus;
  reason: string;
  targetPhase: 'design' | 'archive' | null;
  requiredActions: readonly string[];
  preservedExternalSideEffects: readonly string[];
  storeWrites: readonly [];
  platformCalls: readonly [];
  digest: `sha256:${string}`;
}

function planBase(record: LegacyLifecycleRecord) {
  if (!record.id.trim() || !record.authority.trim() || Object.keys(record.identity).length === 0) {
    throw new Error('Legacy lifecycle record identity is incomplete');
  }
  return {
    schemaVersion: 1 as const,
    kind: 'ChangeLifecycleMigrationPlan' as const,
    fixtureId: record.id,
    legacyKind: record.kind,
    legacyIdentity: Object.fromEntries(Object.entries(record.identity).sort(([a], [b]) => a.localeCompare(b))),
    preservedExternalSideEffects: [...record.externalSideEffects],
    storeWrites: [] as const,
    platformCalls: [] as const,
  };
}

export function planChangeLifecycleMigration(
  record: LegacyLifecycleRecord,
): ChangeLifecycleMigrationPlan {
  const base = planBase(record);
  const legacyStatus = typeof record.state.status === 'string' ? record.state.status : null;
  let decision: Omit<
    ChangeLifecycleMigrationPlan,
    keyof typeof base | 'digest'
  >;
  if (record.kind === 'post-merge-run' && legacyStatus === 'completed') {
    decision = {
      status: 'completed_history',
      reason: 'Completed legacy closure is retained as history and its side effects are not replayed',
      targetPhase: null,
      requiredActions: ['link-completed-history'],
    };
  } else if (record.kind === 'post-merge-run' && record.inputs.includes('exact merge commits')) {
    decision = {
      status: 'migratable',
      reason: 'Exact merge facts uniquely identify the original Change Archive continuation',
      targetPhase: 'archive',
      requiredActions: ['verify-change-run-identity', 'bind-exact-merge-facts'],
    };
  } else if (
    record.kind === 'delivery-v3' &&
    record.inputs.includes('business MR collection') &&
    !record.externalSideEffects.includes('Change MR open')
  ) {
    decision = {
      status: 'migratable',
      reason: 'The frozen Business MR collection can be reconciled into one Archive Work',
      targetPhase: 'archive',
      requiredActions: ['verify-change-run-identity', 'freeze-business-merge-request-set'],
    };
  } else if (record.kind === 'planning-approval') {
    decision = {
      status: 'manual_decision_required',
      reason: 'Legacy approval cannot authorize a recomputed semantic planning manifest',
      targetPhase: 'design',
      requiredActions: [
        'recompute-current-planning-manifest',
        'verify-current-publication-provenance',
        'request-new-trusted-human-decision',
      ],
    };
  } else if (record.kind === 'generic-run') {
    decision = {
      status: 'manual_decision_required',
      reason: 'A generic checkpoint does not uniquely identify a Change lifecycle phase',
      targetPhase: null,
      requiredActions: ['select-change-identity', 'select-target-phase'],
    };
  } else {
    decision = {
      status: 'migration_required',
      reason: 'Legacy state is ambiguous or contains side effects owned by the retired coordinator',
      targetPhase: null,
      requiredActions: ['inspect-authoritative-platform-state', 'resolve-legacy-authority'],
    };
  }
  const unsigned = { ...base, ...decision };
  return {
    ...unsigned,
    digest: `sha256:${createHash('sha256').update(canonicalJson(unsigned)).digest('hex')}`,
  };
}
