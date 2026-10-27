export const HOST_TOOL_CATEGORIES = [
  'repository.read',
  'repository.search',
  'code.edit',
  'test.run',
  'git.inspect',
  'git.publish',
  'external.request',
] as const;

export const HOST_TOOL_RESULTS = ['succeeded', 'failed', 'unknown'] as const;

export type HostToolCategory = (typeof HOST_TOOL_CATEGORIES)[number];
export type HostToolResult = (typeof HOST_TOOL_RESULTS)[number];

export interface HostToolUsage {
  category: HostToolCategory;
  result: HostToolResult;
  durationMs: number;
  callCount: number;
}

export interface HostModelUsage {
  modelVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface HostTelemetryReport {
  schemaVersion: 1;
  toolObservation: 'observed';
  tools: readonly HostToolUsage[];
  modelUsage?: HostModelUsage;
}

export type HostTelemetryFact =
  | { kind: 'observation'; observationStatus: 'observed' | 'unknown' }
  | ({ kind: 'tool-usage' } & HostToolUsage)
  | ({ kind: 'model-usage' } & HostModelUsage);

const TOOL_CATEGORY_SET = new Set<string>(HOST_TOOL_CATEGORIES);
const TOOL_RESULT_SET = new Set<string>(HOST_TOOL_RESULTS);
const MODEL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REPORT_KEYS = new Set(['schemaVersion', 'toolObservation', 'tools', 'modelUsage']);
const TOOL_KEYS = new Set(['category', 'result', 'durationMs', 'callCount']);
const MODEL_KEYS = new Set([
  'modelVersion',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
]);

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedInteger(value: unknown, maximum: number, allowZero: boolean): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= maximum
  );
}

function invalid(): never {
  throw new Error('Invalid Host telemetry report');
}

export function assertHostTelemetryReport(value: unknown): asserts value is HostTelemetryReport {
  const report = record(value);
  if (
    !report ||
    !hasOnlyKeys(report, REPORT_KEYS) ||
    report.schemaVersion !== 1 ||
    report.toolObservation !== 'observed' ||
    !Array.isArray(report.tools) ||
    report.tools.length > 32
  ) {
    invalid();
  }

  for (const candidate of report.tools) {
    const tool = record(candidate);
    if (
      !tool ||
      !hasOnlyKeys(tool, TOOL_KEYS) ||
      typeof tool.category !== 'string' ||
      !TOOL_CATEGORY_SET.has(tool.category) ||
      typeof tool.result !== 'string' ||
      !TOOL_RESULT_SET.has(tool.result) ||
      !isBoundedInteger(tool.durationMs, 7 * 24 * 60 * 60 * 1_000, true) ||
      !isBoundedInteger(tool.callCount, 1_000_000, false)
    ) {
      invalid();
    }
  }

  if (report.modelUsage !== undefined) {
    const model = record(report.modelUsage);
    if (
      !model ||
      !hasOnlyKeys(model, MODEL_KEYS) ||
      typeof model.modelVersion !== 'string' ||
      !MODEL_VERSION.test(model.modelVersion) ||
      !isBoundedInteger(model.inputTokens, Number.MAX_SAFE_INTEGER, true) ||
      !isBoundedInteger(model.outputTokens, Number.MAX_SAFE_INTEGER, true) ||
      (model.cacheReadTokens !== undefined &&
        !isBoundedInteger(model.cacheReadTokens, Number.MAX_SAFE_INTEGER, true)) ||
      (model.cacheWriteTokens !== undefined &&
        !isBoundedInteger(model.cacheWriteTokens, Number.MAX_SAFE_INTEGER, true))
    ) {
      invalid();
    }
  }
}

export function hostTelemetryFacts(
  report: HostTelemetryReport | undefined,
): readonly HostTelemetryFact[] {
  if (report === undefined) {
    return [{ kind: 'observation', observationStatus: 'unknown' }];
  }
  assertHostTelemetryReport(report);
  return [
    { kind: 'observation', observationStatus: 'observed' },
    ...report.tools.map((tool) => ({ kind: 'tool-usage' as const, ...tool })),
    ...(report.modelUsage ? [{ kind: 'model-usage' as const, ...report.modelUsage }] : []),
  ];
}
