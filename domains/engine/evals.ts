import type { EvalDefinition, EvalResult, RunState } from './types.js';

export function evaluateRuntime(
  definitions: readonly EvalDefinition[],
  state: RunState,
): EvalResult[] {
  return definitions.map((definition) => {
    const value = state[definition.field];
    const serialized =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? JSON.stringify(value)
          : value === null
            ? 'null'
            : JSON.stringify(value);
    return {
      evalId: definition.id,
      passed: serialized === definition.equals,
      evidence: `state.${definition.field} = ${serialized}`,
    };
  });
}
