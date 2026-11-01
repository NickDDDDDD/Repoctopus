import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';

export type RuleEvaluationResult = 'passed' | 'violated' | 'unknown';
export type RuleCategory = 'builtin' | 'team' | 'custom';

export interface RuleEvaluationReceipt {
  schemaVersion: 1;
  receiptId: `sha256:${string}`;
  runId: string;
  workId: string;
  attempt: number;
  checkEpoch: number;
  rule: {
    id: string;
    version: string;
    digest: `sha256:${string}`;
    category: RuleCategory;
  };
  evaluator: { id: string; version: string };
  applicable: boolean;
  expected: boolean;
  triggered: boolean;
  result: RuleEvaluationResult;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

type ReceiptInput = Omit<RuleEvaluationReceipt, 'schemaVersion' | 'receiptId' | 'rule'> & {
  rule: Omit<RuleEvaluationReceipt['rule'], 'category'> & { category?: RuleCategory };
};

function receiptIdentity(value: Omit<RuleEvaluationReceipt, 'receiptId'>): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function assertReceipt(value: Omit<RuleEvaluationReceipt, 'receiptId'>): void {
  if (
    value.schemaVersion !== 1 ||
    !SAFE_ID.test(value.runId) ||
    !SAFE_ID.test(value.workId) ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    !Number.isSafeInteger(value.checkEpoch) ||
    value.checkEpoch < 0 ||
    !SAFE_ID.test(value.rule.id) ||
    !SAFE_ID.test(value.rule.version) ||
    !DIGEST.test(value.rule.digest) ||
    !['builtin', 'team', 'custom'].includes(value.rule.category) ||
    !SAFE_ID.test(value.evaluator.id) ||
    !SAFE_ID.test(value.evaluator.version) ||
    !['passed', 'violated', 'unknown'].includes(value.result) ||
    (value.result !== 'unknown' && !value.applicable) ||
    (value.triggered && !value.expected)
  ) {
    throw new Error('Rule evaluation receipt is invalid');
  }
}

export function createRuleEvaluationReceipt(input: ReceiptInput): RuleEvaluationReceipt {
  const stable: Omit<RuleEvaluationReceipt, 'receiptId'> = {
    schemaVersion: 1,
    runId: input.runId,
    workId: input.workId,
    attempt: input.attempt,
    checkEpoch: input.checkEpoch,
    rule: { ...input.rule, category: input.rule.category ?? 'builtin' },
    evaluator: { ...input.evaluator },
    applicable: input.applicable,
    expected: input.expected,
    triggered: input.triggered,
    result: input.result,
  };
  assertReceipt(stable);
  return { ...stable, receiptId: receiptIdentity(stable) };
}

export function parseRuleEvaluationReceipt(value: unknown): RuleEvaluationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Rule evaluation receipt is invalid');
  }
  const receipt = value as RuleEvaluationReceipt;
  const { receiptId, ...stable } = receipt;
  assertReceipt(stable);
  if (!DIGEST.test(receiptId) || receiptId !== receiptIdentity(stable)) {
    throw new Error('Rule evaluation receipt identity is invalid');
  }
  return structuredClone(receipt);
}
