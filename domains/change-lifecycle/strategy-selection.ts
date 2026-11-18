import type { BuildExecutionMode, BuildStrategy, BuildTddMode } from './build-protocol.js';

export interface BuildStrategyPreference {
  schemaVersion: 2;
  executionMode?: BuildExecutionMode;
  tddMode?: BuildTddMode;
}

export interface StrategyRationale {
  summary: string;
  refs: readonly string[];
}

export interface BuildStrategyCandidate {
  schemaVersion: 1;
  kind: 'build-strategy-candidate';
  executionMode: BuildExecutionMode;
  tddMode: BuildTddMode;
  rationale: { execution: StrategyRationale; tdd: StrategyRationale };
}

export interface BuildStrategyProposal {
  schemaVersion: 1;
  candidate: BuildStrategyCandidate;
  strategy: BuildStrategy;
  source: {
    workId: string;
    inputDigest: `sha256:${string}`;
    submissionId: string;
    submissionDigest: `sha256:${string}`;
  };
}

export interface StrategyRevisionRequest {
  schemaVersion: 1;
  requestId: string;
  actorId: string;
  priorStrategyDigest: `sha256:${string}`;
  preference: BuildStrategyPreference;
}

export function assertStrategyModes(value: { executionMode?: unknown; tddMode?: unknown }): void {
  if (
    value.executionMode !== undefined &&
    value.executionMode !== 'autonomous' &&
    value.executionMode !== 'subagent-driven-development'
  )
    throw new Error('Build execution mode is invalid');
  if (value.tddMode !== undefined && value.tddMode !== 'tdd' && value.tddMode !== 'direct')
    throw new Error('Build TDD mode is invalid');
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !keys.includes(key)))
    throw new Error(`${label} contains unsupported fields`);
  return item;
}

function rationale(value: unknown): StrategyRationale {
  const item = record(value, ['summary', 'refs'], 'Strategy rationale');
  if (typeof item.summary !== 'string' || !item.summary.trim() || item.summary.length > 2048)
    throw new Error('Strategy rationale requires a bounded summary');
  if (
    !Array.isArray(item.refs) ||
    item.refs.length < 1 ||
    item.refs.length > 32 ||
    item.refs.some(
      (ref) =>
        typeof ref !== 'string' ||
        !ref.trim() ||
        ref.length > 512 ||
        /^(?:[a-z]:[\\/]|[\\/]|https?:)/iu.test(ref) ||
        ref.split(/[\\/]/u).includes('..'),
    )
  )
    throw new Error('Strategy rationale requires bounded project-relative evidence references');
  return { summary: item.summary, refs: [...item.refs] as string[] };
}

export function parseBuildStrategyCandidate(value: unknown): BuildStrategyCandidate {
  const item = record(
    value,
    ['schemaVersion', 'kind', 'executionMode', 'tddMode', 'rationale'],
    'Build strategy candidate',
  );
  if (
    item.schemaVersion !== 1 ||
    item.kind !== 'build-strategy-candidate' ||
    item.executionMode === undefined ||
    item.tddMode === undefined
  )
    throw new Error('Design requires a complete build strategy candidate');
  assertStrategyModes(item);
  const reasons = record(item.rationale, ['execution', 'tdd'], 'Strategy rationale');
  return {
    schemaVersion: 1,
    kind: 'build-strategy-candidate',
    executionMode: item.executionMode as BuildExecutionMode,
    tddMode: item.tddMode as BuildTddMode,
    rationale: { execution: rationale(reasons.execution), tdd: rationale(reasons.tdd) },
  };
}
