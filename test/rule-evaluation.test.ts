import { describe, expect, it } from 'vitest';

import {
  createRuleEvaluationReceipt,
  parseRuleEvaluationReceipt,
} from '../domains/telemetry/rule-evaluation.js';

describe('rule evaluation receipt', () => {
  it('creates a stable machine-verifiable receipt', () => {
    const first = createRuleEvaluationReceipt({
      runId: 'run-1',
      workId: 'work-1',
      attempt: 1,
      checkEpoch: 2,
      rule: { id: 'build.task-valid', version: '1', digest: `sha256:${'a'.repeat(64)}` },
      evaluator: { id: 'build.task-valid', version: '1' },
      applicable: true,
      expected: true,
      triggered: true,
      result: 'passed',
    });
    const second = createRuleEvaluationReceipt({
      runId: 'run-1',
      workId: 'work-1',
      attempt: 1,
      checkEpoch: 2,
      rule: { id: 'build.task-valid', version: '1', digest: `sha256:${'a'.repeat(64)}` },
      evaluator: { id: 'build.task-valid', version: '1' },
      applicable: true,
      expected: true,
      triggered: true,
      result: 'passed',
    });
    expect(first).toEqual(second);
    expect(parseRuleEvaluationReceipt(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });

  it('rejects self-reported or incomplete evaluations', () => {
    expect(() =>
      parseRuleEvaluationReceipt({
        schemaVersion: 1,
        receiptId: `sha256:${'b'.repeat(64)}`,
        rule: { id: 'text-rule' },
        applicable: true,
        result: 'passed',
      }),
    ).toThrow(/Rule evaluation receipt/u);
  });
});
