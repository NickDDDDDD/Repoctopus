import type { Attributes } from '@opentelemetry/api';

import type { TelemetryBatch } from '../../../domains/runtime/types.js';
import type { TrajectoryEvent } from '../../../domains/trajectory/types.js';
import type { RuntimeStabilityFact } from '../../../domains/runtime/stability.js';
import {
  workspaceIntentMetricAttributes,
  workspaceIntentTraceAttributes,
} from '../workspace-intent-mapping.js';

const SAFE_DATA_KEYS = new Set([
  'actionId',
  'result',
  'recoveredTransition',
  'repositoryCount',
  'workflowName',
  'workflowVersion',
]);

const EXECUTION_DATA_KEYS = new Set([
  'phase',
  'workId',
  'workKind',
  'attempt',
  'checkEpoch',
  'intentId',
  'packetDigest',
  'contextDigest',
  'layerCount',
  'continuation',
  'invocationId',
  'hostId',
  'outcomeId',
  'receiptId',
  'validatorId',
  'result',
  'skillRole',
  'skillName',
  'bindingId',
  'slotId',
  'skillOrder',
  'replacedSkillName',
  'skillCompositionDigest',
  'changedSkillCount',
  'missingCapabilityCount',
  'operationKind',
  'operationId',
  'waitId',
  'reconcileId',
  'durationMs',
  'recovery',
  'findingCount',
  'findingKind',
  'buildAction',
  'strategyId',
  'strategyRevision',
  'bindingRevision',
  'decisionStatus',
  'reasonClass',
  'planId',
  'planRevision',
  'packageId',
  'executionMode',
  'tddMode',
  'reviewMode',
  'isolation',
  'executionId',
  'delegationRole',
  'findingClassification',
  'submissionId',
  'submissionDigest',
  'reasonCode',
  'hostReplayed',
  'dispatchSuppressed',
  'rejectedSubmissionCount',
  'legacyRecovery',
  'proposalStatus',
  'specsStatus',
  'designStatus',
  'tasksStatus',
  'valid',
  'highestSeverity',
  'infoCount',
  'warningCount',
  'errorCount',
  'contractConflict',
  'effectStage',
  'effectCertainty',
  'effectResult',
]);

const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|secret|token|api[-_]?key|environment)/i;
const SENSITIVE_VALUE =
  /(bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const ACTION_RECEIPT_ID = /^[a-f0-9]{64}$/u;
const SAFE_DOMAIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const SAFE_EXECUTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EXECUTION_EVENTS = new Set<TrajectoryEvent['type']>([
  'work.created',
  'work.packet-stored',
  'work.packet-recovered',
  'work.claim-capability-rejected',
  'work.claimed',
  'work.context-delivered',
  'work.host-started',
  'work.host-completed',
  'work.outcome-submitted',
  'work.outcome-corrected',
  'work.outcome-rejected',
  'work.outcome-accepted',
  'work.outcome-processing-error',
  'delegation.completed',
  'work.completed',
  'skill.resolved',
  'skill.delivered',
  'skill.consumed',
  'skill.consumption-rejected',
  'skill-composition.compiled',
  'skill-composition.rejected',
  'skill-composition.drifted',
  'skill-binding.resolved',
  'tool.started',
  'tool.completed',
  'validator.completed',
  'wait.started',
  'wait.ended',
  'reconcile.started',
  'reconcile.completed',
  'continuation.selected',
  'specification.artifacts-observed',
  'specification.validation-observed',
  'recovery.reconciled',
]);

function safeExecutionId(value: string): boolean {
  return (
    SAFE_EXECUTION_ID.test(value) &&
    !value.includes('://') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:\//u.test(value) &&
    !value.startsWith('/')
  );
}

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    if (value.length > 256 || SENSITIVE_VALUE.test(value)) return undefined;
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function addEvidenceCorrelation(attributes: Attributes, event: TrajectoryEvent): void {
  if (event.type !== 'action.completed') return;
  const attemptId = event.data.evidenceAttemptId;
  if (typeof attemptId === 'string' && SAFE_DOMAIN_ID.test(attemptId)) {
    attributes['repoctopus.evidence.attempt.id'] = attemptId;
  }
  const gate = event.data.evidenceGate;
  if (!gate || typeof gate !== 'object') return;
  const record = gate as Record<string, unknown>;
  if (typeof record.bundleId === 'string' && SAFE_DOMAIN_ID.test(record.bundleId)) {
    attributes['repoctopus.evidence.bundle.id'] = record.bundleId;
  }
  if (record.status === 'satisfied' || record.status === 'blocked') {
    attributes['repoctopus.evidence.gate.status'] = record.status;
  }
  if (record.outcome === 'passed' || record.outcome === 'failed') {
    attributes['repoctopus.evidence.outcome'] = record.outcome;
  }
}

function addProjectReconciliationAttributes(attributes: Attributes, event: TrajectoryEvent): void {
  if (event.type !== 'run.resumed' && event.type !== 'recovery.reconciled') return;
  const reconciliation = event.data.reconciliation;
  if (!reconciliation || typeof reconciliation !== 'object') return;
  const record = reconciliation as Record<string, unknown>;
  if (
    record.changeClass === 'same' ||
    record.changeClass === 'content' ||
    record.changeClass === 'identity'
  ) {
    attributes['repoctopus.project.reconciliation.class'] = record.changeClass;
  }
  if (typeof record.requiresReconciliation === 'boolean') {
    attributes['repoctopus.project.reconciliation.required'] = record.requiresReconciliation;
  }
}

function authorizedBranchRebindFact(event: TrajectoryEvent): Record<string, unknown> | null {
  const value = event.data.authorizedBranchRebind;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function addAuthorizedBranchRebindTraceAttributes(
  attributes: Attributes,
  event: TrajectoryEvent,
): void {
  const fact = authorizedBranchRebindFact(event);
  if (!fact) return;
  if (fact.entrypoint === 'next' || fact.entrypoint === 'resume') {
    attributes['repoctopus.build.rebind.entrypoint'] = fact.entrypoint;
  }
  if (fact.classification === 'authorized-protected-branch-rebind') {
    attributes['repoctopus.build.rebind.classification'] = fact.classification;
  }
  if (fact.result === 'dispatched' || fact.result === 'idempotent') {
    attributes['repoctopus.build.rebind.result'] = fact.result;
  }
  if (typeof fact.poisonRecovery === 'boolean') {
    attributes['repoctopus.build.rebind.poison_recovery'] = fact.poisonRecovery;
  }
  if (typeof fact.repositoryCount === 'number' && Number.isSafeInteger(fact.repositoryCount)) {
    attributes['repoctopus.build.rebind.repository_count'] = fact.repositoryCount;
  }
  if (typeof fact.authorizationDigest === 'string' && DIGEST.test(fact.authorizationDigest)) {
    attributes['repoctopus.build.rebind.authorization_digest'] = fact.authorizationDigest;
  }
}

function addAuthorizedBranchRebindMetricAttributes(
  attributes: Attributes,
  event: TrajectoryEvent,
): void {
  const fact = authorizedBranchRebindFact(event);
  if (!fact) return;
  attributes['repoctopus.build.rebind.entrypoint'] =
    fact.entrypoint === 'next' || fact.entrypoint === 'resume' ? fact.entrypoint : 'unknown';
  attributes['repoctopus.build.rebind.result'] =
    fact.result === 'dispatched' || fact.result === 'idempotent' ? fact.result : 'unknown';
  attributes['repoctopus.build.rebind.poison_recovery'] = fact.poisonRecovery === true;
}

export function safeEventAttributes(batch: TelemetryBatch, event: TrajectoryEvent): Attributes {
  const attributes: Attributes = {
    'repoctopus.project.id': batch.projectSnapshot.projectId,
    'repoctopus.run.id': batch.run.runId,
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.workflow.version': batch.run.workflowVersion,
    'repoctopus.workflow.digest': batch.run.workflowDigest,
    'repoctopus.composition.digest': batch.run.composition.compositionDigest,
    'repoctopus.event.id': event.eventId,
    'repoctopus.event.sequence': event.sequence,
    'repoctopus.state.version': event.stateVersion,
    'repoctopus.repository.count': batch.projectSnapshot.repositories.length,
  };
  if (batch.run.currentStep) attributes['repoctopus.stage.name'] = batch.run.currentStep;

  const action = event.data.action;
  if (action && typeof action === 'object') {
    const actionRecord = action as Record<string, unknown>;
    const type = scalar(actionRecord.type);
    const ref = scalar(actionRecord.ref);
    if (type !== undefined) attributes['repoctopus.action.type'] = type;
    if (ref !== undefined) attributes['repoctopus.action.ref'] = ref;
  }
  for (const [key, value] of Object.entries(event.data)) {
    if (!SAFE_DATA_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const safe = scalar(value);
    if (safe !== undefined) attributes[`repoctopus.event.${key}`] = safe;
  }
  if (EXECUTION_EVENTS.has(event.type)) {
    for (const [key, value] of Object.entries(event.data)) {
      if (!EXECUTION_DATA_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
      if (
        (key.endsWith('Digest') && (typeof value !== 'string' || !DIGEST.test(value))) ||
        (key.endsWith('Id') &&
          (typeof value !== 'string' || (!safeExecutionId(value) && !DIGEST.test(value))))
      ) {
        continue;
      }
      let normalized = value;
      if (key === 'workKind' && typeof value === 'string' && !BOUNDED_WORK_KINDS.has(value)) {
        normalized = 'custom';
      } else if (key === 'phase' && typeof value === 'string' && !BOUNDED_PHASES.has(value)) {
        normalized = 'unknown';
      } else if (key === 'result' && typeof value === 'string' && !BOUNDED_RESULTS.has(value)) {
        normalized = 'unknown';
      } else if (
        key.endsWith('Status') &&
        typeof value === 'string' &&
        !BOUNDED_ARTIFACT_STATUSES.has(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'highestSeverity' &&
        typeof value === 'string' &&
        !BOUNDED_SEVERITIES.has(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'reasonCode' &&
        typeof value === 'string' &&
        !BOUNDED_REASON_CODES.has(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'effectStage' &&
        typeof value === 'string' &&
        !['push', 'merge-request'].includes(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'effectCertainty' &&
        typeof value === 'string' &&
        !['not-applied', 'unknown'].includes(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'effectResult' &&
        typeof value === 'string' &&
        !['retryable', 'reconcile'].includes(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'findingKind' &&
        typeof value === 'string' &&
        ![
          'implementation_failure',
          'design_assumption_invalid',
          'planning_semantics_changed',
          'evidence_unavailable',
          'external_result_unknown',
        ].includes(value)
      ) {
        normalized = 'unknown';
      } else if (
        key === 'skillName' &&
        typeof value === 'string' &&
        ![
          'repoctopus-open-change',
          'repoctopus-design-change',
          'repoctopus-build-configure',
          'repoctopus-build-plan',
          'repoctopus-build-execute',
          'repoctopus-build-check',
          'repoctopus-verify-change',
          'repoctopus-archive-change',
          'grilling',
          'tdd',
          'codebase-design',
          'diagnosing-bugs',
          'code-review',
          'pr',
        ].includes(value)
      ) {
        normalized = 'custom';
      }
      const safe = scalar(normalized);
      if (safe !== undefined) attributes[`repoctopus.execution.${key}`] = safe;
    }
  }
  const actionReceiptId = event.data.actionReceiptId;
  if (typeof actionReceiptId === 'string' && ACTION_RECEIPT_ID.test(actionReceiptId)) {
    attributes['repoctopus.action.receipt.id'] = actionReceiptId;
  }
  addEvidenceCorrelation(attributes, event);
  addProjectReconciliationAttributes(attributes, event);
  addAuthorizedBranchRebindTraceAttributes(attributes, event);
  if (
    event.type === 'continuation.selected' &&
    (event.data.observationStage === 'provider-validation' ||
      event.data.observationStage === 'planning-gate')
  ) {
    attributes['repoctopus.open.observation.stage'] = event.data.observationStage;
  }
  if (event.type === 'change.lifecycle.transitioned') {
    Object.assign(attributes, workspaceIntentTraceAttributes(event));
    const observationKind = scalar(event.data.observationKind);
    if (observationKind !== undefined) {
      attributes['repoctopus.lifecycle.observation.kind'] = observationKind;
    }
    const observation = event.data.observation;
    if (observation && typeof observation === 'object') {
      const record = observation as Record<string, unknown>;
      if (
        record.invalidationKind === 'semantic' ||
        record.invalidationKind === 'approval-authority'
      ) {
        attributes['repoctopus.planning.invalidation.kind'] = record.invalidationKind;
      }
      const buildProtocol =
        record.buildProtocol && typeof record.buildProtocol === 'object'
          ? (record.buildProtocol as Record<string, unknown>)
          : undefined;
      const strategySource = record.strategy ?? buildProtocol?.strategy;
      const strategy =
        strategySource && typeof strategySource === 'object'
          ? (strategySource as Record<string, unknown>)
          : undefined;
      if (strategy) {
        const value = strategy;
        for (const key of ['executionMode', 'tddMode', 'reviewMode', 'isolation'] as const) {
          const sourceKey = key === 'isolation' ? 'isolationIntent' : key;
          const safe = scalar(value[sourceKey]);
          if (safe !== undefined) attributes[`repoctopus.build.${key}`] = safe;
        }
        if (typeof value.strategyId === 'string' && safeExecutionId(value.strategyId)) {
          attributes['repoctopus.build.strategy.id'] = value.strategyId;
        }
        if (typeof value.revision === 'number' && Number.isSafeInteger(value.revision)) {
          attributes['repoctopus.build.strategy.revision'] = value.revision;
        }
      }
      const bindingSource = record.binding ?? buildProtocol?.binding;
      const binding =
        bindingSource && typeof bindingSource === 'object'
          ? (bindingSource as Record<string, unknown>)
          : undefined;
      if (binding) {
        if (typeof binding.bindingId === 'string' && safeExecutionId(binding.bindingId)) {
          attributes['repoctopus.build.binding.id'] = binding.bindingId;
        }
        if (typeof binding.revision === 'number' && Number.isSafeInteger(binding.revision)) {
          attributes['repoctopus.build.binding.revision'] = binding.revision;
        }
      }
      const rawObservationKind = event.data.observationKind;
      const semanticEvent =
        rawObservationKind === 'build-binding-accepted'
          ? 'build.binding.validated'
          : rawObservationKind === 'build-binding-revalidation-required'
            ? 'build.binding.drifted'
            : rawObservationKind === 'build-binding-retry-required'
              ? 'build.binding.rejected'
              : rawObservationKind === 'build-plan-evidence-accepted'
                ? 'build.plan.preflight.accepted'
                : rawObservationKind === 'build-plan-retry-required'
                  ? 'build.plan.preflight.rejected'
                  : undefined;
      if (semanticEvent) attributes['repoctopus.build.event'] = semanticEvent;
      if (
        typeof record.reasonCode === 'string' &&
        ['host', 'checkout', 'head', 'path', 'protected-branch-correction'].includes(
          record.reasonCode,
        )
      ) {
        attributes['repoctopus.build.reason.class'] = record.reasonCode;
      }
      const plan = record.plan;
      if (plan && typeof plan === 'object') {
        const value = plan as Record<string, unknown>;
        if (typeof value.planId === 'string' && safeExecutionId(value.planId)) {
          attributes['repoctopus.build.plan.id'] = value.planId;
        }
        if (typeof value.revision === 'number' && Number.isSafeInteger(value.revision)) {
          attributes['repoctopus.build.plan.revision'] = value.revision;
        }
      }
      const invalidation = record.invalidation;
      if (invalidation && typeof invalidation === 'object') {
        const value = invalidation as Record<string, unknown>;
        const classification = scalar(value.classification);
        if (classification !== undefined) {
          attributes['repoctopus.build.finding.classification'] = classification;
        }
      }
    }
  }
  if (event.type === 'wait.started' || event.type === 'wait.ended') {
    if (event.data.waitKind === 'human-decision') {
      attributes['repoctopus.human_decision.event'] =
        event.type === 'wait.started' ? 'created' : 'resolved';
    }
  }
  return attributes;
}

const BOUNDED_PHASES = new Set(['open', 'design', 'build', 'verify', 'archive']);
const BOUNDED_WORK_KINDS = new Set([
  'change.intake',
  'specification.plan',
  'build.configure',
  'build.plan',
  'build.execute',
  'build.check',
  'evidence.verify',
  'specification.close',
  'delivery.publish',
]);
const BOUNDED_RESULTS = new Set([
  'succeeded',
  'failed',
  'unknown',
  'accepted',
  'rejected',
  'implementation-failure',
  'evidence-unavailable',
  'created',
  'reused',
  'recovered',
  'missing',
  'corrupt',
  'legacy',
  'reconcile',
  'selected',
  'suppressed',
  'not-executed',
  'executed',
  'unavailable',
  'blocked',
]);
const BOUNDED_ARTIFACT_STATUSES = new Set(['ready', 'skipped', 'missing']);
const BOUNDED_SEVERITIES = new Set(['none', 'info', 'warning', 'error']);
const BOUNDED_REASON_CODES = new Set([
  'output-invalid',
  'outcome-rejected',
  'outcome-processing-error',
  'checkpoint-superseded',
  'open-observation-unavailable',
  'open-gate-pending',
  'capability-required',
]);
const BOUNDED_OPEN_REPAIR_SOURCES = new Set([
  'provider-artifacts',
  'strict-validation',
  'lifecycle-validator',
  'approval-drift',
]);
const BOUNDED_OPEN_REPAIR_REASON_CODES = new Set([
  'provider-artifacts-invalid',
  'strict-validation-invalid',
  'lifecycle-validator-rejected',
  'approval-drift',
]);

export function executionMetricAttributes(event: TrajectoryEvent): Attributes | null {
  if (!EXECUTION_EVENTS.has(event.type)) return null;
  const phase = typeof event.data.phase === 'string' ? event.data.phase : 'unknown';
  const workKind = typeof event.data.workKind === 'string' ? event.data.workKind : 'unknown';
  const result = typeof event.data.result === 'string' ? event.data.result : 'unknown';
  const continuation =
    typeof event.data.continuation === 'string' &&
    ['execute', 'reobserve', 'ask', 'wait', 'reconcile', 'awaiting-correction', 'done'].includes(
      event.data.continuation,
    )
      ? event.data.continuation
      : 'unknown';
  const reasonCode =
    typeof event.data.reasonCode === 'string' && BOUNDED_REASON_CODES.has(event.data.reasonCode)
      ? event.data.reasonCode
      : 'none';
  const buildAction =
    typeof event.data.buildAction === 'string' &&
    ['configure', 'plan', 'execute', 'check'].includes(event.data.buildAction)
      ? event.data.buildAction
      : 'none';
  const executionMode =
    typeof event.data.executionMode === 'string' &&
    ['autonomous', 'subagent-driven-development'].includes(event.data.executionMode)
      ? event.data.executionMode
      : 'none';
  const tddMode =
    typeof event.data.tddMode === 'string' && ['tdd', 'direct'].includes(event.data.tddMode)
      ? event.data.tddMode
      : 'none';
  const isolation =
    typeof event.data.isolation === 'string' &&
    ['current', 'branch', 'worktree'].includes(event.data.isolation)
      ? event.data.isolation
      : 'none';
  const effectStage =
    event.data.effectStage === 'push' || event.data.effectStage === 'merge-request'
      ? event.data.effectStage
      : undefined;
  const effectCertainty =
    event.data.effectCertainty === 'not-applied' || event.data.effectCertainty === 'unknown'
      ? event.data.effectCertainty
      : undefined;
  const effectResult =
    event.data.effectResult === 'retryable' || event.data.effectResult === 'reconcile'
      ? event.data.effectResult
      : undefined;
  return {
    'repoctopus.execution.event.type': event.type,
    'repoctopus.execution.phase': BOUNDED_PHASES.has(phase) ? phase : 'unknown',
    'repoctopus.execution.work.kind': BOUNDED_WORK_KINDS.has(workKind) ? workKind : 'custom',
    'repoctopus.execution.result': BOUNDED_RESULTS.has(result) ? result : 'unknown',
    'repoctopus.execution.continuation': continuation,
    'repoctopus.execution.reason.code': reasonCode,
    ...(event.data.observationStage === 'provider-validation' ||
    event.data.observationStage === 'planning-gate'
      ? { 'repoctopus.open.observation.stage': event.data.observationStage }
      : {}),
    ...(typeof event.data.hostReplayed === 'boolean'
      ? { 'repoctopus.execution.host.replayed': event.data.hostReplayed }
      : {}),
    'repoctopus.build.action': buildAction,
    'repoctopus.build.execution.mode': executionMode,
    'repoctopus.build.tdd.mode': tddMode,
    'repoctopus.build.isolation': isolation,
    ...(effectStage ? { 'repoctopus.publication.effect.stage': effectStage } : {}),
    ...(effectCertainty ? { 'repoctopus.publication.effect.certainty': effectCertainty } : {}),
    ...(effectResult ? { 'repoctopus.publication.effect.result': effectResult } : {}),
  };
}

export function eventSeverity(type: TrajectoryEvent['type']): number {
  return type === 'recovery.reconciled' ||
    type === 'work.claim-capability-rejected' ||
    type === 'work.outcome-rejected' ||
    type === 'work.outcome-processing-error'
    ? 13
    : 9;
}

export function workflowEventMetricAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Attributes {
  const result: Attributes = {
    'repoctopus.event.type': event.type,
    'repoctopus.workflow.name': batch.run.workflowName,
    ...workspaceIntentMetricAttributes(event),
  };
  addProjectReconciliationAttributes(result, event);
  addAuthorizedBranchRebindMetricAttributes(result, event);
  if (event.type === 'work.packet-stored' || event.type === 'work.packet-recovered') {
    const packetResult = event.data.result;
    const allowed =
      event.type === 'work.packet-stored'
        ? new Set(['created', 'reused'])
        : new Set(['recovered', 'missing', 'corrupt', 'legacy']);
    result['repoctopus.packet.result'] =
      typeof packetResult === 'string' && allowed.has(packetResult) ? packetResult : 'unknown';
  }
  if (event.type === 'specification.artifacts-observed') {
    for (const key of ['proposalStatus', 'specsStatus', 'designStatus', 'tasksStatus'] as const) {
      const value = event.data[key];
      result[`repoctopus.specification.artifact.${key}`] =
        typeof value === 'string' && BOUNDED_ARTIFACT_STATUSES.has(value) ? value : 'unknown';
    }
  }
  if (event.type === 'specification.validation-observed') {
    const severity = event.data.highestSeverity;
    result['repoctopus.specification.validation.valid'] = event.data.valid === true;
    result['repoctopus.specification.validation.highest_severity'] =
      typeof severity === 'string' && BOUNDED_SEVERITIES.has(severity) ? severity : 'unknown';
    result['repoctopus.specification.validation.contract_conflict'] =
      event.data.contractConflict === true;
  }
  if (event.type === 'change.lifecycle.transitioned') {
    const transitionInvalidation = event.data.changeLifecycleTransition?.invalidation;
    if (transitionInvalidation) {
      const classification = transitionInvalidation.classification;
      const disposition = transitionInvalidation.disposition;
      const scope = transitionInvalidation.scope;
      const continuation = transitionInvalidation.continuation;
      if (classification === 'semantic' || classification === 'approval-authority') {
        result['repoctopus.runtime.invalidation.classification'] = classification;
      }
      if (disposition === 'invalidate') {
        result['repoctopus.runtime.invalidation.disposition'] = disposition;
      }
      if (scope === 'exact') result['repoctopus.runtime.invalidation.scope'] = scope;
      if (continuation === 'design') {
        result['repoctopus.runtime.invalidation.continuation'] = continuation;
      }
    }
    const observation = event.data.observation;
    const invalidationKind =
      observation && typeof observation === 'object'
        ? (observation as Record<string, unknown>).invalidationKind
        : undefined;
    if (invalidationKind === 'semantic' || invalidationKind === 'approval-authority') {
      result['repoctopus.planning.invalidation.kind'] = invalidationKind;
    }
    const repair = event.data.changeLifecycleTransition?.openRepair;
    if (repair) {
      const source = repair.source;
      const reasonCode = repair.reasonCode;
      result['repoctopus.open.repair.source'] =
        typeof source === 'string' && BOUNDED_OPEN_REPAIR_SOURCES.has(source) ? source : 'unknown';
      result['repoctopus.open.repair.reason_code'] =
        typeof reasonCode === 'string' && BOUNDED_OPEN_REPAIR_REASON_CODES.has(reasonCode)
          ? reasonCode
          : 'unknown';
      result['repoctopus.open.repair.result'] = 'dispatched';
      result['repoctopus.open.repair.execution_retired'] =
        event.data.executionRetirement !== undefined;
    }
  }
  return result;
}

export function runtimeStabilityMetricAttributes(fact: RuntimeStabilityFact): Attributes {
  return {
    'repoctopus.runtime.stability.kind': fact.kind,
    'repoctopus.runtime.stability.authority': fact.authority,
    'repoctopus.runtime.stability.result': fact.result,
    ...(fact.kind === 'invalidation'
      ? {
          'repoctopus.runtime.invalidation.classification': fact.classification,
          'repoctopus.runtime.invalidation.scope': fact.result,
          'repoctopus.runtime.invalidation.continuation': fact.continuation,
        }
      : {}),
    ...(fact.kind === 'dispatch'
      ? { 'repoctopus.runtime.stability.continuation': fact.continuation }
      : {}),
  };
}

export function workflowStepMetricAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Attributes {
  const result = event.data.result;
  return {
    'repoctopus.workflow.name': batch.run.workflowName,
    'repoctopus.event.result': result === 'succeeded' || result === 'failed' ? result : 'unknown',
  };
}
