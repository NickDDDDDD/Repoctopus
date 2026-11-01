import { describe, expect, it } from 'vitest';

import { continuationDiagnostics } from '../app/cli/continuation-diagnostics.js';
import type { WorkExecutionRecovery } from '../domains/work-execution/types.js';

function continuation(
  kind: WorkExecutionRecovery['continuation'],
  reason: WorkExecutionRecovery['reason'],
): WorkExecutionRecovery {
  return {
    schemaVersion: 2,
    continuation: kind,
    reason,
    workId: 'build.execute:abc',
    attempt: 1,
    checkEpoch: 3,
  };
}

describe('CLI continuation diagnostics', () => {
  it.each([
    [
      continuation('reconcile', 'host-result-unknown'),
      'runtime.continuation.reconciliation-required',
    ],
    [
      continuation('awaiting-correction', 'outcome-rejected'),
      'runtime.continuation.correction-required',
    ],
    [continuation('ask', 'human-decision'), 'runtime.continuation.human-decision-required'],
  ] as const)('maps an actionable committed continuation to %s', (input, code) => {
    const diagnostics = continuationDiagnostics(input);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(code);
    expect(diagnostics[0]?.message).not.toMatch(/[\\/]:?/u);
  });

  it.each([
    continuation('execute', 'work-unclaimed'),
    continuation('wait', 'host-active'),
    continuation('done', 'terminal'),
  ])('does not emit noise for %s', (input) => {
    expect(continuationDiagnostics(input)).toEqual([]);
  });
});
