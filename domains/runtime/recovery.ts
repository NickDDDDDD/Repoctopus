import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { RUNTIME_IDENTITY_KINDS, type RuntimeIdentityKind } from './identity.js';
import { runtimeInvalidationScope } from './invalidation.js';

export type RecoveryAuthority = 'planning' | 'plan' | 'work' | 'evidence';
export type RecoveryAction =
  | 'revise-design'
  | 'revise-plan'
  | 'continue-build'
  | 'invalidate-evidence'
  | 'retry-infrastructure'
  | 'reconcile-external';

type PlanningStatus = 'current' | 'drift';
type PlanStatus = 'current' | 'drift';
type WorkStatus = 'current' | 'retryable' | 'external-result-unknown';
type EvidenceStatus = 'current' | 'drift' | 'unavailable';

export interface RecoveryLayerObservation<Status extends string> {
  status: Status;
  reasonCode?: string;
  changedIdentities: RuntimeIdentityKind[];
}

export interface RecoveryObservation {
  schemaVersion: 1;
  runId: string;
  expectedRevision: number;
  checkEpoch: number;
  observationId: string;
  planning: RecoveryLayerObservation<PlanningStatus>;
  plan: RecoveryLayerObservation<PlanStatus>;
  work: RecoveryLayerObservation<WorkStatus>;
  evidence: RecoveryLayerObservation<EvidenceStatus>;
}

export interface RecoveryDecision {
  schemaVersion: 1;
  decisionId: `recovery:sha256:${string}`;
  runId: string;
  expectedRevision: number;
  checkEpoch: number;
  observationId: string;
  authority: RecoveryAuthority;
  action: RecoveryAction;
  reasonCode: string;
  changedIdentities: RuntimeIdentityKind[];
  retainedIdentities: RuntimeIdentityKind[];
  invalidatedIdentities: RuntimeIdentityKind[];
}

const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'runId',
  'expectedRevision',
  'checkEpoch',
  'observationId',
  'planning',
  'plan',
  'work',
  'evidence',
]);
const LAYER_FIELDS = new Set(['status', 'reasonCode', 'changedIdentities']);
const IDENTITY_KINDS = new Set<string>(RUNTIME_IDENTITY_KINDS);

const STATUS_BY_AUTHORITY = {
  planning: new Set<PlanningStatus>(['current', 'drift']),
  plan: new Set<PlanStatus>(['current', 'drift']),
  work: new Set<WorkStatus>(['current', 'retryable', 'external-result-unknown']),
  evidence: new Set<EvidenceStatus>(['current', 'drift', 'unavailable']),
} as const;

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new Error(`Recovery observation ${name} is invalid`);
  }
}

function parseLayer(
  authority: RecoveryAuthority,
  value: unknown,
): RecoveryLayerObservation<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Recovery observation ${authority} facts are invalid`);
  }
  const layer = value as Record<string, unknown>;
  const unknown = Object.keys(layer).find((field) => !LAYER_FIELDS.has(field));
  if (unknown) {
    if (/phase/iu.test(unknown)) {
      throw new Error('Recovery observation Host cannot select a phase');
    }
    if (/action/iu.test(unknown)) {
      throw new Error('Recovery observation Host cannot select a recovery action');
    }
    throw new Error(`Recovery observation ${authority} contains unsupported field: ${unknown}`);
  }
  if (
    typeof layer.status !== 'string' ||
    !STATUS_BY_AUTHORITY[authority].has(layer.status as never)
  ) {
    throw new Error(`Recovery observation ${authority} status is invalid`);
  }
  if (!Array.isArray(layer.changedIdentities) || layer.changedIdentities.length > 32) {
    throw new Error(`Recovery observation ${authority} identities are invalid`);
  }
  const changedIdentities = [...new Set(layer.changedIdentities)].map((identity) => {
    if (typeof identity !== 'string' || !IDENTITY_KINDS.has(identity)) {
      throw new Error(`Recovery observation ${authority} identity is invalid`);
    }
    return identity as RuntimeIdentityKind;
  });
  if (layer.status !== 'current') {
    assertIdentifier(layer.reasonCode, `${authority} reasonCode`);
  } else if (layer.reasonCode !== undefined) {
    throw new Error(`Recovery observation ${authority} current facts cannot have a reasonCode`);
  }
  return {
    status: layer.status,
    ...(layer.reasonCode === undefined ? {} : { reasonCode: layer.reasonCode }),
    changedIdentities: changedIdentities.sort(),
  };
}

export function parseRecoveryObservation(value: unknown): RecoveryObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Recovery observation must be an object');
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).find((field) => !TOP_LEVEL_FIELDS.has(field));
  if (unknown) {
    if (/phase/iu.test(unknown)) {
      throw new Error('Recovery observation Host cannot select a phase');
    }
    if (/action/iu.test(unknown)) {
      throw new Error('Recovery observation Host cannot select a recovery action');
    }
    throw new Error(`Recovery observation contains unsupported field: ${unknown}`);
  }
  if (raw.schemaVersion !== 1) throw new Error('Recovery observation schema is unsupported');
  assertIdentifier(raw.runId, 'runId');
  assertIdentifier(raw.observationId, 'observationId');
  if (!Number.isSafeInteger(raw.expectedRevision) || (raw.expectedRevision as number) < 0) {
    throw new Error('Recovery observation expectedRevision is invalid');
  }
  if (!Number.isSafeInteger(raw.checkEpoch) || (raw.checkEpoch as number) < 0) {
    throw new Error('Recovery observation checkEpoch is invalid');
  }

  return Object.freeze({
    schemaVersion: 1,
    runId: raw.runId,
    expectedRevision: raw.expectedRevision as number,
    checkEpoch: raw.checkEpoch as number,
    observationId: raw.observationId,
    planning: parseLayer('planning', raw.planning) as RecoveryObservation['planning'],
    plan: parseLayer('plan', raw.plan) as RecoveryObservation['plan'],
    work: parseLayer('work', raw.work) as RecoveryObservation['work'],
    evidence: parseLayer('evidence', raw.evidence) as RecoveryObservation['evidence'],
  });
}

function selectedDecision(observation: RecoveryObservation): {
  authority: RecoveryAuthority;
  action: RecoveryAction;
  layer: RecoveryLayerObservation<string>;
} | null {
  if (observation.planning.status === 'drift') {
    return { authority: 'planning', action: 'revise-design', layer: observation.planning };
  }
  if (observation.plan.status === 'drift') {
    return { authority: 'plan', action: 'revise-plan', layer: observation.plan };
  }
  if (observation.work.status === 'retryable') {
    return { authority: 'work', action: 'continue-build', layer: observation.work };
  }
  if (observation.work.status === 'external-result-unknown') {
    return { authority: 'work', action: 'reconcile-external', layer: observation.work };
  }
  if (observation.evidence.status === 'drift') {
    return {
      authority: 'evidence',
      action: 'invalidate-evidence',
      layer: observation.evidence,
    };
  }
  if (observation.evidence.status === 'unavailable') {
    return {
      authority: 'evidence',
      action: 'retry-infrastructure',
      layer: observation.evidence,
    };
  }
  return null;
}

export function classifyRecoveryObservation(value: unknown): RecoveryDecision | null {
  const observation = parseRecoveryObservation(value);
  const selected = selectedDecision(observation);
  if (!selected) return null;

  const changedIdentities = [...new Set(selected.layer.changedIdentities)].sort();
  const scope = runtimeInvalidationScope(changedIdentities);
  const reasonCode = selected.layer.reasonCode as string;
  const identityMaterial = {
    schemaVersion: 1,
    runId: observation.runId,
    expectedRevision: observation.expectedRevision,
    checkEpoch: observation.checkEpoch,
    observationId: observation.observationId,
    authority: selected.authority,
    action: selected.action,
    reasonCode,
    changedIdentities,
    invalidatedIdentities: scope.invalidatedIdentities,
  };
  const digest = createHash('sha256').update(canonicalJson(identityMaterial)).digest('hex');

  return Object.freeze({
    schemaVersion: 1,
    decisionId: `recovery:sha256:${digest}`,
    runId: observation.runId,
    expectedRevision: observation.expectedRevision,
    checkEpoch: observation.checkEpoch,
    observationId: observation.observationId,
    authority: selected.authority,
    action: selected.action,
    reasonCode,
    changedIdentities,
    retainedIdentities: scope.retainedIdentities,
    invalidatedIdentities: scope.invalidatedIdentities,
  });
}
