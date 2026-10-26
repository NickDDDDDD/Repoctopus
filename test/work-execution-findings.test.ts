import { describe, expect, it } from 'vitest';

import { assertBoundedWorkExecutionFindings } from '../domains/work-execution/findings.js';
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
  it('accepts only bounded findings and never a Host-selected phase', () => {
    expect(() =>
      assertBoundedWorkExecutionFindings(
        outcome([
          {
            kind: 'design_assumption_invalid',
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
});
