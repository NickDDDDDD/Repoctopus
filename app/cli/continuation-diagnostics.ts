import type { RuntimeDiagnostic } from '../../domains/runtime/types.js';
import type { WorkExecutionRecovery } from '../../domains/work-execution/types.js';

/** Returns bounded, path-free diagnostics for continuations that require operator action. */
export function continuationDiagnostics(
  continuation: WorkExecutionRecovery | undefined,
): RuntimeDiagnostic[] {
  if (!continuation) return [];
  if (continuation.continuation === 'reconcile') {
    return [
      {
        level: 'warning',
        code: 'runtime.continuation.reconciliation-required',
        message: `Committed continuation requires reconciliation (${continuation.reason})`,
      },
    ];
  }
  if (continuation.continuation === 'awaiting-correction') {
    return [
      {
        level: 'warning',
        code: 'runtime.continuation.correction-required',
        message: `Committed continuation requires a corrected Outcome (${continuation.reason})`,
      },
    ];
  }
  if (continuation.continuation === 'ask') {
    return [
      {
        level: 'info',
        code: 'runtime.continuation.human-decision-required',
        message: 'Committed continuation requires a Human Decision',
      },
    ];
  }
  return [];
}
