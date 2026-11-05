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
  changedIdentities: readonly RuntimeIdentityKind[];
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
  changedIdentities: readonly RuntimeIdentityKind[];
  retainedIdentities: readonly RuntimeIdentityKind[];
  invalidatedIdentities: readonly RuntimeIdentityKind[];
}

export interface RecoveryAuthorityDiff {
  authority: RecoveryAuthority;
  action: RecoveryAction;
  reasonCode: string;
  changedIdentities: readonly RuntimeIdentityKind[];
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

const ACTION_CONTRACTS = {
  'revise-design': {
    authority: 'planning',
    reasons: new Set([
      'requirements-changed',
      'design-changed',
      'tasks-changed',
      'approval-authority-changed',
      'validation-observation-changed',
    ]),
    identities: new Set<RuntimeIdentityKind>([
      'planning-semantic',
      'validation-observation',
      'approval-authority',
    ]),
    requiresIdentity: true,
  },
  'revise-plan': {
    authority: 'plan',
    reasons: new Set([
      'package-not-completable',
      'plan-constraint-changed',
      'authorization-envelope-expanded',
      'command-shape-changed',
    ]),
    identities: new Set<RuntimeIdentityKind>([
      'composition',
      'build-strategy',
      'execution-binding',
      'build-plan',
    ]),
    requiresIdentity: true,
  },
  'continue-build': {
    authority: 'work',
    reasons: new Set(['implementation-failed', 'outcome-rejected', 'execution-interrupted']),
    identities: new Set<RuntimeIdentityKind>([
      'work-input',
      'package-completion',
      'execution-checkpoint',
    ]),
    requiresIdentity: false,
  },
  'reconcile-external': {
    authority: 'work',
    reasons: new Set(['external-result-unknown']),
    identities: new Set<RuntimeIdentityKind>([
      'work-input',
      'package-completion',
      'execution-checkpoint',
      'publication-provenance',
    ]),
    requiresIdentity: false,
  },
  'invalidate-evidence': {
    authority: 'evidence',
    reasons: new Set(['declared-input-changed', 'receipt-input-changed']),
    identities: new Set<RuntimeIdentityKind>(['evidence-dependency', 'verification-input']),
    requiresIdentity: true,
  },
  'retry-infrastructure': {
    authority: 'evidence',
    reasons: new Set(['evidence-provider-unavailable']),
    identities: new Set<RuntimeIdentityKind>([]),
    requiresIdentity: false,
  },
} as const satisfies Record<
  RecoveryAction,
  {
    authority: RecoveryAuthority;
    reasons: ReadonlySet<string>;
    identities: ReadonlySet<RuntimeIdentityKind>;
    requiresIdentity: boolean;
  }
>;

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

function actionForStatus(authority: RecoveryAuthority, status: string): RecoveryAction | null {
  if (authority === 'planning' && status === 'drift') return 'revise-design';
  if (authority === 'plan' && status === 'drift') return 'revise-plan';
  if (authority === 'work' && status === 'retryable') return 'continue-build';
  if (authority === 'work' && status === 'external-result-unknown') {
    return 'reconcile-external';
  }
  if (authority === 'evidence' && status === 'drift') return 'invalidate-evidence';
  if (authority === 'evidence' && status === 'unavailable') return 'retry-infrastructure';
  return null;
}

function assertDiffContract(
  authority: RecoveryAuthority,
  action: RecoveryAction,
  reasonCode: string,
  changedIdentities: readonly RuntimeIdentityKind[],
): void {
  const contract = ACTION_CONTRACTS[action];
  if (contract.authority !== authority) {
    throw new Error(`Recovery ${action} authority is invalid`);
  }
  if (!contract.reasons.has(reasonCode)) {
    throw new Error(`Recovery observation ${authority} reasonCode is invalid`);
  }
  if (
    (contract.requiresIdentity && changedIdentities.length === 0) ||
    changedIdentities.some((identity) => !contract.identities.has(identity))
  ) {
    throw new Error(`Recovery observation ${authority} identity set is invalid`);
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
    const action = actionForStatus(authority, layer.status);
    if (!action) throw new Error(`Recovery observation ${authority} status is invalid`);
    assertDiffContract(authority, action, layer.reasonCode, changedIdentities);
  } else if (layer.reasonCode !== undefined) {
    throw new Error(`Recovery observation ${authority} current facts cannot have a reasonCode`);
  } else if (changedIdentities.length > 0) {
    throw new Error(`Recovery observation ${authority} current facts cannot change identities`);
  }
  return Object.freeze({
    status: layer.status,
    ...(layer.reasonCode === undefined ? {} : { reasonCode: layer.reasonCode }),
    changedIdentities: Object.freeze(changedIdentities.sort()),
  });
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

type RecoveryInspector = (observation: RecoveryObservation) => RecoveryAuthorityDiff | null;

function diff(
  authority: RecoveryAuthority,
  action: RecoveryAction,
  layer: RecoveryLayerObservation<string>,
): RecoveryAuthorityDiff {
  return Object.freeze({
    authority,
    action,
    reasonCode: layer.reasonCode as string,
    changedIdentities: Object.freeze([...new Set(layer.changedIdentities)].sort()),
  });
}

const inspectPlanning: RecoveryInspector = (observation) => {
  if (observation.planning.status === 'drift') {
    return diff('planning', 'revise-design', observation.planning);
  }
  return null;
};

const inspectPlan: RecoveryInspector = (observation) => {
  if (observation.plan.status === 'drift') {
    return diff('plan', 'revise-plan', observation.plan);
  }
  return null;
};

const inspectWork: RecoveryInspector = (observation) => {
  if (observation.work.status === 'retryable') {
    return diff('work', 'continue-build', observation.work);
  }
  if (observation.work.status === 'external-result-unknown') {
    return diff('work', 'reconcile-external', observation.work);
  }
  return null;
};

const inspectEvidence: RecoveryInspector = (observation) => {
  if (observation.evidence.status === 'drift') {
    return diff('evidence', 'invalidate-evidence', observation.evidence);
  }
  if (observation.evidence.status === 'unavailable') {
    return diff('evidence', 'retry-infrastructure', observation.evidence);
  }
  return null;
};

const ORDERED_INSPECTORS: readonly RecoveryInspector[] = [
  inspectPlanning,
  inspectPlan,
  inspectWork,
  inspectEvidence,
];

function selectedDecision(observation: RecoveryObservation): RecoveryAuthorityDiff | null {
  for (const inspector of ORDERED_INSPECTORS) {
    const authorityDiff = inspector(observation);
    if (authorityDiff) return authorityDiff;
  }
  return null;
}

export function classifyRecoveryObservation(value: unknown): RecoveryDecision | null {
  const observation = parseRecoveryObservation(value);
  const selected = selectedDecision(observation);
  if (!selected) return null;

  const changedIdentities = selected.changedIdentities;
  const scope = runtimeInvalidationScope(changedIdentities);
  const reasonCode = selected.reasonCode;
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
    changedIdentities: Object.freeze([...changedIdentities]),
    retainedIdentities: Object.freeze([...scope.retainedIdentities]),
    invalidatedIdentities: Object.freeze([...scope.invalidatedIdentities]),
  });
}

export function assertRecoveryDecision(decision: RecoveryDecision): void {
  assertIdentifier(decision.runId, 'decision runId');
  assertIdentifier(decision.observationId, 'decision observationId');
  if (!Number.isSafeInteger(decision.expectedRevision) || decision.expectedRevision < 0) {
    throw new Error('Recovery decision expectedRevision is invalid');
  }
  if (!Number.isSafeInteger(decision.checkEpoch) || decision.checkEpoch < 0) {
    throw new Error('Recovery decision checkEpoch is invalid');
  }
  const changedIdentities = [...new Set(decision.changedIdentities)].sort();
  if (changedIdentities.length !== decision.changedIdentities.length) {
    throw new Error('Recovery decision changed identities are not canonical');
  }
  assertDiffContract(decision.authority, decision.action, decision.reasonCode, changedIdentities);
  const scope = runtimeInvalidationScope(changedIdentities);
  if (
    canonicalJson(decision.retainedIdentities) !== canonicalJson(scope.retainedIdentities) ||
    canonicalJson(decision.invalidatedIdentities) !== canonicalJson(scope.invalidatedIdentities)
  ) {
    throw new Error('Recovery decision invalidation closure is invalid');
  }
  const identityMaterial = {
    schemaVersion: 1,
    runId: decision.runId,
    expectedRevision: decision.expectedRevision,
    checkEpoch: decision.checkEpoch,
    observationId: decision.observationId,
    authority: decision.authority,
    action: decision.action,
    reasonCode: decision.reasonCode,
    changedIdentities,
    invalidatedIdentities: scope.invalidatedIdentities,
  };
  const expectedId = `recovery:sha256:${createHash('sha256')
    .update(canonicalJson(identityMaterial))
    .digest('hex')}`;
  if (decision.decisionId !== expectedId) {
    throw new Error('Recovery decision identity does not match its content');
  }
}
