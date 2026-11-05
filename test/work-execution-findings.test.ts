import { describe, expect, it } from 'vitest';

import {
  assertBoundedWorkExecutionFindings,
  assertWorkExecutionFindingReferences,
  normalizeWorkExecutionFindings,
} from '../domains/work-execution/findings.js';
import type { WorkExecutionHostOutcome } from '../domains/work-execution/types.js';

const digest = `sha256:${'a'.repeat(64)}` as const;

function outcome(findings: unknown): WorkExecutionHostOutcome {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    hostId: 'host-1',
    packetDigest: digest,
    status: 'failed',
    summary: 'bounded result',
    consumedLayerDigests: [],
    findings,
    completedAt: '2026-10-26T00:00:00.000Z',
  } as WorkExecutionHostOutcome;
}

describe('Work Execution Host findings', () => {
  it('accepts only bounded fact findings and never a Host-selected phase', () => {
    expect(() =>
      assertBoundedWorkExecutionFindings(
        outcome([
          {
            kind: 'authority_conflict',
            code: 'approved-requirement-conflict',
            summary: 'The repository disproves an approved design assumption.',
            requirementIds: ['change-lifecycle#host-findings'],
            taskIds: ['4.1'],
          },
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      assertBoundedWorkExecutionFindings(
        outcome([
          {
            kind: 'implementation_failure',
            summary: 'Host tries to choose the next phase.',
            targetPhase: 'archive',
          },
        ]),
      ),
    ).toThrow(/unsupported field/u);
    expect(() =>
      assertBoundedWorkExecutionFindings({
        ...outcome([]),
        targetPhase: 'design',
      } as WorkExecutionHostOutcome),
    ).toThrow(/cannot select a target phase/u);
    expect(() =>
      assertBoundedWorkExecutionFindings(
        outcome(
          Array.from({ length: 17 }, () => ({
            kind: 'implementation_failure',
            summary: 'failure',
          })),
        ),
      ),
    ).toThrow(/exceed the bound/u);
  });

  it.each(['design_assumption_invalid', 'planning_semantics_changed'])(
    'rejects the obsolete action-shaped finding %s',
    (kind) => {
      expect(() =>
        assertBoundedWorkExecutionFindings(
          outcome([{ kind, code: 'legacy-action', summary: 'obsolete control signal' }]),
        ),
      ).toThrow(/invalid bounded finding/u);
    },
  );

  it('normalizes bounded references and excludes summary text from stable identity', () => {
    const first = normalizeWorkExecutionFindings(
      outcome([
        {
          kind: 'plan_constraint',
          code: 'package-not-completable',
          summary: 'RED and GREEN were split.',
          requirementIds: ['req-b', 'req-a', 'req-a'],
          taskIds: ['task-2', 'task-1'],
          packageIds: ['package-1'],
          evidenceIds: ['evidence-2', 'evidence-1'],
        },
      ]),
    )[0]!;
    const second = normalizeWorkExecutionFindings(
      outcome([
        {
          kind: 'plan_constraint',
          code: 'package-not-completable',
          summary: 'Different diagnostic prose.',
          requirementIds: ['req-a', 'req-b'],
          taskIds: ['task-1', 'task-2'],
          packageIds: ['package-1'],
          evidenceIds: ['evidence-1', 'evidence-2'],
        },
      ]),
    )[0]!;

    expect(first).toMatchObject({
      kind: 'plan_constraint',
      code: 'package-not-completable',
      requirementIds: ['req-a', 'req-b'],
      taskIds: ['task-1', 'task-2'],
      packageIds: ['package-1'],
      evidenceIds: ['evidence-1', 'evidence-2'],
    });
    expect(first.identity).toMatch(/^finding:sha256:[a-f0-9]{64}$/u);
    expect(second.identity).toBe(first.identity);
  });

  it('rejects references outside the current Requirement, Task, Package, and Evidence authority', () => {
    const [finding] = normalizeWorkExecutionFindings(
      outcome([
        {
          kind: 'evidence_mismatch',
          code: 'check-input-mismatch',
          summary: 'The submitted check cites an unrelated Evidence identity.',
          requirementIds: ['req-1'],
          taskIds: ['task-1'],
          packageIds: ['package-1'],
          evidenceIds: ['evidence-other'],
        },
      ]),
    );

    expect(() =>
      assertWorkExecutionFindingReferences([finding!], {
        requirementIds: ['req-1'],
        taskIds: ['task-1'],
        packageIds: ['package-1'],
        evidenceIds: ['evidence-1'],
      }),
    ).toThrow(/unknown Evidence/u);
  });
});
