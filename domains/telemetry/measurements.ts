import { createHash } from 'node:crypto';

import type { TelemetryBatch } from '../runtime/types.js';
import type { TrajectoryEvent } from '../trajectory/types.js';
import { parseRuleEvaluationReceipt, type RuleCategory } from './rule-evaluation.js';

export type SkillMeasurementResult = 'consumed' | 'completed' | 'error' | 'corrected';

export interface SkillMeasurement {
  schemaVersion: 1;
  measurementId: `sha256:${string}`;
  sourceEventId: string;
  timestamp: string;
  runId: string;
  workId: string;
  attempt: number;
  invocationId: string;
  skillId: string;
  role: 'action' | 'augmentation';
  category: 'builtin' | 'team' | 'custom';
  result: SkillMeasurementResult;
}

export interface RuleMeasurement {
  schemaVersion: 1;
  measurementId: `sha256:${string}`;
  sourceEventId: string;
  timestamp: string;
  runId: string;
  workId: string;
  ruleId: string;
  ruleDigest: `sha256:${string}`;
  evaluatorId: string;
  evaluatorVersion: string;
  category: RuleCategory;
  result: 'expected' | 'triggered' | 'passed' | 'violated' | 'unknown';
}

export interface WorkflowMeasurement {
  schemaVersion: 1;
  measurementId: `sha256:${string}`;
  sourceEventId: string;
  timestamp: string;
  runId: string;
  workflowName: string;
  workflowVersion: string;
  result: 'started' | 'completed' | 'failed';
  durationMs: number | null;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const BUILTIN_SKILLS = new Set([
  'repoctopus-open-change',
  'repoctopus-design-change',
  'repoctopus-build-task',
  'repoctopus-verify-change',
  'repoctopus-archive-change',
  'grilling',
  'tdd',
  'codebase-design',
  'diagnosing-bugs',
  'code-review',
  'pr',
]);

function identity(...parts: readonly string[]): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(parts.join('\0')).digest('hex')}`;
}

function sameWork(event: TrajectoryEvent, workId: string, attempt: number): boolean {
  return event.data.workId === workId && event.data.attempt === attempt;
}

function consumedSkill(
  event: TrajectoryEvent,
): Omit<SkillMeasurement, 'measurementId' | 'sourceEventId' | 'timestamp' | 'result'> | null {
  if (event.type !== 'skill.consumed') return null;
  const { workId, attempt, invocationId, skillName, skillRole, skillCategory } = event.data;
  if (
    typeof workId !== 'string' ||
    !SAFE_ID.test(workId) ||
    !Number.isSafeInteger(attempt) ||
    typeof invocationId !== 'string' ||
    !SAFE_ID.test(invocationId) ||
    typeof skillName !== 'string' ||
    !SAFE_ID.test(skillName) ||
    (skillRole !== 'action' && skillRole !== 'augmentation')
  ) {
    return null;
  }
  const category =
    skillCategory === 'team' || skillCategory === 'custom' || skillCategory === 'builtin'
      ? skillCategory
      : BUILTIN_SKILLS.has(skillName)
        ? 'builtin'
        : 'custom';
  return {
    schemaVersion: 1,
    runId: event.runId,
    workId,
    attempt: Number(attempt),
    invocationId,
    skillId: skillName,
    role: skillRole,
    category,
  };
}

function skillRecord(
  skill: NonNullable<ReturnType<typeof consumedSkill>>,
  source: TrajectoryEvent,
  result: SkillMeasurementResult,
): SkillMeasurement {
  return {
    ...skill,
    measurementId: identity(source.eventId, skill.skillId, result),
    sourceEventId: source.eventId,
    timestamp: source.timestamp,
    result,
  };
}

const CORRECTION_TRANSITIONS = new Set([
  'design.revision-requested',
  'build.adoption-rejected',
  'build.design-revision-required',
  'build.design-revision-approved',
  'build.semantic-plan-drift',
  'verify.semantic-plan-drift',
  'verify.failed',
  'archive.reverify',
  'archive.intent-corrected',
  'archive.planning-drift',
]);

export function projectSkillMeasurements(batch: TelemetryBatch): SkillMeasurement[] {
  const records: SkillMeasurement[] = [];
  for (const source of batch.events) {
    if (source.type === 'skill.consumed') {
      const skill = consumedSkill(source);
      if (skill) records.push(skillRecord(skill, source, 'consumed'));
      continue;
    }
    if (source.type === 'validator.completed' || source.type === 'work.completed') {
      const workId = typeof source.data.workId === 'string' ? source.data.workId : null;
      const attempt = Number.isSafeInteger(source.data.attempt)
        ? Number(source.data.attempt)
        : null;
      if (!workId || attempt === null) continue;
      const result =
        source.type === 'validator.completed' && source.data.result === 'accepted'
          ? 'completed'
          : source.data.result === 'failed' || source.data.result === 'rejected'
            ? 'error'
            : null;
      if (!result) continue;
      for (const candidate of batch.trajectory) {
        if (!sameWork(candidate, workId, attempt)) continue;
        const skill = consumedSkill(candidate);
        if (skill) records.push(skillRecord(skill, source, result));
      }
      continue;
    }
    if (source.type === 'change.lifecycle.transitioned') {
      const fact = source.data.changeLifecycleTransition;
      const previousWorkId = fact?.previousWorkId;
      if (!fact || !CORRECTION_TRANSITIONS.has(fact.transitionId) || !previousWorkId) continue;
      for (const candidate of batch.trajectory) {
        if (candidate.data.workId !== previousWorkId) continue;
        const skill = consumedSkill(candidate);
        if (skill) records.push(skillRecord(skill, source, 'corrected'));
      }
    }
  }
  return records;
}

export function projectRuleMeasurements(batch: TelemetryBatch): RuleMeasurement[] {
  const records: RuleMeasurement[] = [];
  for (const source of batch.events) {
    if (source.type !== 'validator.completed' || !source.data.ruleEvaluation) continue;
    let receipt;
    try {
      receipt = parseRuleEvaluationReceipt(source.data.ruleEvaluation);
    } catch {
      continue;
    }
    if (receipt.runId !== source.runId) continue;
    const results: RuleMeasurement['result'][] = [];
    if (receipt.applicable && receipt.expected) results.push('expected');
    if (receipt.applicable && receipt.triggered) results.push('triggered');
    results.push(receipt.result);
    for (const result of results) {
      records.push({
        schemaVersion: 1,
        measurementId: identity(source.eventId, receipt.receiptId, result),
        sourceEventId: source.eventId,
        timestamp: source.timestamp,
        runId: source.runId,
        workId: receipt.workId,
        ruleId: receipt.rule.id,
        ruleDigest: receipt.rule.digest,
        evaluatorId: receipt.evaluator.id,
        evaluatorVersion: receipt.evaluator.version,
        category: receipt.rule.category,
        result,
      });
    }
  }
  return records;
}

export function projectWorkflowMeasurements(batch: TelemetryBatch): WorkflowMeasurement[] {
  const records: WorkflowMeasurement[] = [];
  const started = batch.trajectory.find((event) => event.type === 'run.started');
  for (const source of batch.events) {
    let result: WorkflowMeasurement['result'] | null = null;
    if (source.type === 'run.started') result = 'started';
    if (source.type === 'change.lifecycle.transitioned') {
      const status = source.data.changeLifecycleTransition?.to.status;
      if (status === 'completed' || status === 'failed') result = status;
    }
    if (!result) continue;
    const durationMs =
      result === 'started' || !started
        ? null
        : Math.max(0, Date.parse(source.timestamp) - Date.parse(started.timestamp));
    records.push({
      schemaVersion: 1,
      measurementId: identity(source.eventId, result),
      sourceEventId: source.eventId,
      timestamp: source.timestamp,
      runId: source.runId,
      workflowName: batch.run.workflowName,
      workflowVersion: batch.run.workflowVersion,
      result,
      durationMs,
    });
  }
  return records;
}
