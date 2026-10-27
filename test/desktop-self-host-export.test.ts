import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { decodeOtlpJsonProjectionObservations } from '../app/desktop/host/otlp-json-projection.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import { encodeOtlpJsonRequests } from '../platform/telemetry/canonical-otlp-json-exporter.js';
import { exportSelfHostedRun } from '../scripts/self-host-run-export.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () =>
  Promise.all(cleanup.splice(0).map((value) => rm(value, { recursive: true }))),
);

describe('self-hosted Desktop export', () => {
  it('replays one persisted real Run through the canonical OTLP seam', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-self-host-export-'));
    cleanup.push(workspace);
    const store = new FileRuntimeStore(workspace);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    await runtime.start({
      workflow: workflowFixture(),
      projectSnapshot: projectFixture(),
      runId: 'run-self-host-export',
    });
    const batches: unknown[] = [];
    const result = await exportSelfHostedRun({
      workspace,
      runId: 'run-self-host-export',
      telemetry: {
        export: (batch) => {
          batches.push(batch);
          return Promise.resolve();
        },
      },
    });
    expect(result).toMatchObject({ runId: 'run-self-host-export', trajectoryEvents: 1 });
    expect(batches).toHaveLength(1);
  });

  it('round-trips canonical OTLP logs through the Desktop projection decoder', () => {
    const observedAt = '2026-10-27T16:00:00.000Z';
    const requests = encodeOtlpJsonRequests({
      spans: [],
      metrics: [],
      logs: [
        {
          observedAt,
          resourceAttributes: { 'repoctopus.workspace.id': 'workspace-self-host' },
          scope: {
            schemaVersion: 1,
            name: 'io.repoctopus.observation',
            version: '1.0.0',
          },
          eventName: 'repoctopus.skill.resolved',
          body: 'Repoctopus workflow event: skill.resolved',
          traceId: '1'.repeat(32),
          spanId: '2'.repeat(16),
          attributes: {
            'repoctopus.event.id': 'event-self-host',
            'repoctopus.event.sequence': 1,
            'repoctopus.change.id': 'change-self-host',
            'repoctopus.run.id': 'run-self-host-roundtrip',
            'repoctopus.execution.phase': 'build',
            'repoctopus.skill.name': 'tdd',
            'repoctopus.skill.role': 'augmentation',
          },
        },
      ],
    });
    const observations = decodeOtlpJsonProjectionObservations(
      Buffer.from(JSON.stringify(requests.logs)),
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      runId: 'run-self-host-roundtrip',
      eventName: 'skill.resolved',
      skill: { name: 'tdd', role: 'augmentation' },
    });
  });
});
