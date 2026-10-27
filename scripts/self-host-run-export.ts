import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { TelemetryPort } from '../domains/runtime/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { CanonicalOtlpJsonExporter } from '../platform/telemetry/canonical-otlp-json-exporter.js';

export interface SelfHostedRunExportOptions {
  workspace: string;
  runId: string;
  telemetry: TelemetryPort;
}

export interface SelfHostedRunExportResult {
  schemaVersion: 1;
  runId: string;
  trajectoryEvents: number;
  firstSequence: number;
  lastSequence: number;
  eventTypes: readonly string[];
}

/** Replays one immutable persisted Run through the same canonical OTLP mapper as live delivery. */
export async function exportSelfHostedRun(
  options: SelfHostedRunExportOptions,
): Promise<SelfHostedRunExportResult> {
  const store = new FileRuntimeStore(options.workspace);
  const [run, workflow, projectSnapshot, trajectory] = await Promise.all([
    store.loadRun(options.runId),
    store.loadWorkflow(options.runId),
    store.loadProjectSnapshot(options.runId),
    store.loadTrajectory(options.runId),
  ]);
  if (trajectory.length === 0) throw new Error('Self-hosted Run has no persisted Trajectory');
  await options.telemetry.export({
    run,
    workflow,
    projectSnapshot,
    events: trajectory,
    trajectory,
  });
  return {
    schemaVersion: 1,
    runId: options.runId,
    trajectoryEvents: trajectory.length,
    firstSequence: trajectory[0]!.sequence,
    lastSequence: trajectory.at(-1)!.sequence,
    eventTypes: [...new Set(trajectory.map((event) => event.type))].sort(),
  };
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const result = await exportSelfHostedRun({
    workspace: argument('--workspace'),
    runId: argument('--run'),
    telemetry: new CanonicalOtlpJsonExporter({
      endpoint: argument('--endpoint'),
      headers: { 'x-repoctopus-session': argument('--token') },
      timeoutMillis: 15_000,
    }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
