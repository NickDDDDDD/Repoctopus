import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowRunCoordinator } from '../../domains/runtime/workflow-runs.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import {
  CanonicalOtlpJsonExporter,
  IsolatedTelemetryFanout,
} from '../../platform/telemetry/canonical-otlp-json-exporter.js';
import { DecisionTelemetryRecorder } from '../../services/decision-telemetry-recorder.js';
import {
  compositionFixture,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from '../helpers/fixtures.js';

const receiverScript = path.resolve(
  import.meta.dirname,
  '..',
  'fixtures',
  'otlp-process-receiver.mjs',
);
const cleanupDirectories: string[] = [];
const cleanupProcesses: ChildProcess[] = [];

afterEach(async () => {
  for (const child of cleanupProcesses.splice(0)) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await Promise.all(cleanupDirectories.splice(0).map(removeTemporaryDirectory));
});

async function receiver(root: string, name: string) {
  const output = path.join(root, `${name}.jsonl`);
  const state = path.join(root, `${name}.status`);
  await writeFile(output, '');
  await writeFile(state, '200');
  const child = spawn(process.execPath, [receiverScript, output, state], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  cleanupProcesses.push(child);
  const endpoint = await new Promise<string>((resolve, reject) => {
    let stdout = '';
    const fail = (error: Error) => reject(error);
    child.once('error', fail);
    child.stderr?.once('data', (value) => reject(new Error(String(value))));
    child.stdout?.on('data', (value) => {
      stdout += String(value);
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      child.off('error', fail);
      resolve((JSON.parse(stdout.slice(0, newline)) as { endpoint: string }).endpoint);
    });
  });
  return {
    endpoint,
    fail: (status: number) => writeFile(state, String(status)),
    records: async () => {
      const content = await readFile(output, 'utf8');
      return content
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { path: string; contentType: string; body: unknown });
    },
  };
}

function envelopeIds(records: readonly { body: unknown }[]): string[] {
  const text = JSON.stringify(records);
  return [...text.matchAll(/sha256:[a-f0-9]{64}/gu)].map((match) => match[0]);
}

describe('canonical OTLP multi-destination delivery', () => {
  it('delivers one real Run identically and isolates either process failure', async () => {
    const root = await temporaryDirectory('repoctopus-dual-otlp-');
    cleanupDirectories.push(root);
    const remote = await receiver(root, 'remote');
    const desktop = await receiver(root, 'desktop');
    const telemetry = new IsolatedTelemetryFanout([
      {
        destinationId: 'remote:mock',
        telemetry: new CanonicalOtlpJsonExporter({ endpoint: remote.endpoint }),
      },
      {
        destinationId: 'desktop:mock',
        telemetry: new CanonicalOtlpJsonExporter({ endpoint: desktop.endpoint }),
      },
    ]);
    const store = new FileRuntimeStore(path.join(root, 'runtime'));
    const runtime = new WorkflowRunCoordinator(store, telemetry, compositionFixture());
    const decisions = new DecisionTelemetryRecorder(store, telemetry);

    const started = await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-dual-destination-e2e',
    });
    expect(started.value.state.runId).toBe('run-dual-destination-e2e');
    await decisions.record({
      runId: 'run-dual-destination-e2e',
      decisionId: 'open-approval-1',
      kind: 'open-approval',
      stage: 'requested',
    });
    const remoteBaseline = await remote.records();
    const desktopBaseline = await desktop.records();
    expect(new Set(remoteBaseline.map(({ path: requestPath }) => requestPath))).toEqual(
      new Set(['/v1/logs', '/v1/metrics', '/v1/traces']),
    );
    expect(remoteBaseline.toSorted((left, right) => left.path.localeCompare(right.path))).toEqual(
      desktopBaseline.toSorted((left, right) => left.path.localeCompare(right.path)),
    );
    expect(new Set(envelopeIds(remoteBaseline)).size).toBeGreaterThan(0);
    expect(JSON.stringify(remoteBaseline)).not.toMatch(
      /authorization|credential|password|secret|session|command.output|prompt|reply/iu,
    );

    await remote.fail(503);
    await decisions.record({
      runId: 'run-dual-destination-e2e',
      decisionId: 'open-approval-1',
      kind: 'open-approval',
      stage: 'resolved',
      outcome: 'approve',
    });
    expect(telemetry.latestResults()).toMatchObject([
      { destinationId: 'remote:mock', result: 'failed' },
      { destinationId: 'desktop:mock', result: 'delivered' },
    ]);
    expect((await remote.records()).length).toBe(remoteBaseline.length);
    expect((await desktop.records()).length).toBeGreaterThan(desktopBaseline.length);

    await remote.fail(200);
    await desktop.fail(503);
    const status = await runtime.status('run-dual-destination-e2e');
    expect(status.state.runId).toBe('run-dual-destination-e2e');
    await decisions.record({
      runId: 'run-dual-destination-e2e',
      decisionId: 'design-approval-1',
      kind: 'design-approval',
      stage: 'requested',
    });
    expect(telemetry.latestResults()).toMatchObject([
      { destinationId: 'remote:mock', result: 'delivered' },
      { destinationId: 'desktop:mock', result: 'failed' },
    ]);
    expect((await remote.records()).length).toBeGreaterThan(remoteBaseline.length);
    expect((await desktop.records()).length).toBeGreaterThan(desktopBaseline.length);
    expect((await runtime.status('run-dual-destination-e2e')).state.status).not.toBe('failed');
  }, 120_000);
});
