import type { Attributes } from '@opentelemetry/api';

import type { TrajectoryEvent } from '../../domains/trajectory/types.js';

const SAFE_EXECUTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const BOUNDED_PHASES = new Set(['open', 'design', 'build', 'verify', 'archive']);
const BOUNDED_BINDING_ERROR_CODES = new Set([
  'workspace-identity-mismatch',
  'repository-topology-drift',
  'remote-identity-drift',
  'current-checkout-mismatch',
  'current-linked-worktree',
  'branch-mismatch',
  'worktree-ownership-missing',
]);
const BOUNDED_ISOLATIONS = new Set(['current', 'branch', 'worktree']);
const BOUNDED_RETIREMENT_REASONS = new Set(['workspace-intent-revision']);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeExecutionId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    SAFE_EXECUTION_ID.test(value) &&
    !value.includes('://') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    !/^[A-Za-z]:\//u.test(value) &&
    !value.startsWith('/')
    ? value
    : undefined;
}

function workspaceIntentFacts(event: TrajectoryEvent) {
  if (event.type !== 'change.lifecycle.transitioned') return null;
  const transition = record(event.data.changeLifecycleTransition);
  const revision = record(transition?.workspaceIntentRevision);
  const retirement = record(event.data.executionRetirement);
  if (!revision && !retirement) return null;
  const from = record(transition?.from);
  const to = record(transition?.to);
  const errorCode = revision
    ? (boundedString(revision.errorCode, BOUNDED_BINDING_ERROR_CODES) ?? 'unknown')
    : undefined;
  const retirementReason = boundedString(retirement?.reason, BOUNDED_RETIREMENT_REASONS);
  return {
    fromPhase: boundedString(from?.phase, BOUNDED_PHASES),
    toPhase: boundedString(to?.phase, BOUNDED_PHASES),
    errorCode,
    recovery: revision ? 'intent-revision' : undefined,
    previousIsolation: boundedString(revision?.previousIsolation, BOUNDED_ISOLATIONS),
    currentIsolation: boundedString(revision?.nextIsolation, BOUNDED_ISOLATIONS),
    retired: retirementReason !== undefined,
    retirementReason,
    retiredWorkId: safeExecutionId(retirement?.retiredWorkId),
    retiredCheckEpoch: nonNegativeInteger(retirement?.retiredCheckEpoch),
    nextWorkId: safeExecutionId(retirement?.nextWorkId),
    nextCheckEpoch: nonNegativeInteger(retirement?.nextCheckEpoch),
  };
}

/** Bounded recovery facts for logs/traces; correlation identities never enter Metrics. */
export function workspaceIntentTraceAttributes(event: TrajectoryEvent): Attributes {
  const facts = workspaceIntentFacts(event);
  if (!facts) return {};
  return {
    ...(facts.fromPhase ? { 'repoctopus.change.phase.before': facts.fromPhase } : {}),
    ...(facts.toPhase ? { 'repoctopus.change.phase': facts.toPhase } : {}),
    ...(facts.errorCode
      ? { 'repoctopus.workspace.binding.error.code': facts.errorCode }
      : {}),
    ...(facts.recovery
      ? { 'repoctopus.workspace.binding.recovery': facts.recovery }
      : {}),
    ...(facts.previousIsolation
      ? { 'repoctopus.workspace.isolation.previous': facts.previousIsolation }
      : {}),
    ...(facts.currentIsolation
      ? { 'repoctopus.workspace.isolation.current': facts.currentIsolation }
      : {}),
    'repoctopus.execution.retired': facts.retired,
    ...(facts.retirementReason
      ? { 'repoctopus.execution.retirement.reason': facts.retirementReason }
      : {}),
    ...(facts.retiredWorkId
      ? { 'repoctopus.execution.retirement.work.id': facts.retiredWorkId }
      : {}),
    ...(facts.retiredCheckEpoch !== undefined
      ? { 'repoctopus.execution.retirement.check_epoch': facts.retiredCheckEpoch }
      : {}),
    ...(facts.nextWorkId ? { 'repoctopus.execution.next.work.id': facts.nextWorkId } : {}),
    ...(facts.nextCheckEpoch !== undefined
      ? { 'repoctopus.execution.next.check_epoch': facts.nextCheckEpoch }
      : {}),
  };
}

export function workspaceIntentMetricAttributes(event: TrajectoryEvent): Attributes {
  const facts = workspaceIntentFacts(event);
  if (!facts) return {};
  return {
    'repoctopus.change.phase.before': facts.fromPhase ?? 'unknown',
    'repoctopus.change.phase': facts.toPhase ?? 'unknown',
    'repoctopus.workspace.binding.error.code': facts.errorCode ?? 'none',
    'repoctopus.workspace.binding.recovery': facts.recovery ?? 'none',
    'repoctopus.workspace.isolation.previous': facts.previousIsolation ?? 'none',
    'repoctopus.workspace.isolation.current': facts.currentIsolation ?? 'none',
    'repoctopus.execution.retired': facts.retired,
    'repoctopus.execution.retirement.reason': facts.retirementReason ?? 'none',
  };
}
