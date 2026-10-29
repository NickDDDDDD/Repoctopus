import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { encodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { RunState } from '../domains/engine/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import {
  createObservationEnvelope,
  type ObservationEnvelope,
} from '../domains/trajectory/observation.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';

export interface SelfHostedRunSource {
  loadRun(runId: string): Promise<RunState>;
  loadProjectSnapshot(runId: string): Promise<ProjectSnapshot>;
  loadTrajectory(runId: string): Promise<TrajectoryEvent[]>;
}

export interface SelfHostedRunExportOptions {
  workspace: string;
  runId: string;
  endpoint: string;
  token: string;
  source?: SelfHostedRunSource;
  fetch?: typeof globalThis.fetch;
  batchSize?: number;
}

export interface SelfHostedRunExportResult {
  schemaVersion: 1;
  runId: string;
  changeId: string | null;
  workspaceId: string;
  trajectoryEvents: number;
  firstSequence: number;
  lastSequence: number;
  requestCount: number;
  eventTypes: readonly string[];
}

function receiverUrl(endpoint: string): URL {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Self-host export requires the authenticated IPv4 loopback Receiver');
  }
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/v1/logs`;
  return url;
}

async function send(
  destination: URL,
  token: string,
  envelopes: readonly ObservationEnvelope[],
  fetch: typeof globalThis.fetch,
): Promise<void> {
  const response = await fetch(destination, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: encodeObservationOtlpJson(envelopes, 'log'),
  });
  if (!response.ok) {
    throw new Error(`Desktop Receiver rejected self-host batch with ${response.status}`);
  }
}

/**
 * Replays one persisted authoritative Run through the production observation mapper and OTLP
 * codec. This utility never reads product state on behalf of the Dashboard: it acts as a normal
 * telemetry producer, while the installed application remains receive-driven.
 */
export async function exportSelfHostedRun(
  options: SelfHostedRunExportOptions,
): Promise<SelfHostedRunExportResult> {
  const source = options.source ?? new FileRuntimeStore(options.workspace);
  const [run, projectSnapshot, trajectory] = await Promise.all([
    source.loadRun(options.runId),
    source.loadProjectSnapshot(options.runId),
    source.loadTrajectory(options.runId),
  ]);
  if (trajectory.length === 0) throw new Error('Self-hosted Run has no persisted Trajectory');
  const batchSize = options.batchSize ?? 256;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) {
    throw new Error('Self-host export batch size must be between 1 and 256');
  }
  const changeId = run.changeLifecycle?.identity.changeId ?? null;
  const context = {
    workspaceId: projectSnapshot.projectId,
    ...(changeId ? { changeId } : {}),
    workflowName: run.workflowName,
    workflowVersion: run.workflowVersion,
  };
  const observations = trajectory.map((event) => createObservationEnvelope(event, context));
  const destination = receiverUrl(options.endpoint);
  const fetch = options.fetch ?? globalThis.fetch;
  let requestCount = 0;
  for (let index = 0; index < observations.length; index += batchSize) {
    try {
      await send(destination, options.token, observations.slice(index, index + batchSize), fetch);
    } catch (error) {
      const first = observations[index]?.identity.sequence;
      const last =
        observations[Math.min(index + batchSize, observations.length) - 1]?.identity.sequence;
      throw new Error(
        `Self-host export failed for trajectory sequences ${first}-${last}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    requestCount += 1;
  }
  return {
    schemaVersion: 1,
    runId: options.runId,
    changeId,
    workspaceId: projectSnapshot.projectId,
    trajectoryEvents: trajectory.length,
    firstSequence: trajectory[0]!.sequence,
    lastSequence: trajectory.at(-1)!.sequence,
    requestCount,
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
    endpoint: argument('--endpoint'),
    token: argument('--token'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
