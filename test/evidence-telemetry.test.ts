import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceRuntime } from '../app/evidence-runtime.js';
import type {
  EvidenceTelemetryBatch,
  EvidenceTelemetryPort,
} from '../domains/evidence/telemetry.js';
import { createEvidenceTelemetryBatch } from '../domains/evidence/telemetry.js';
import type { SharedProjectConfig } from '../domains/project-configuration/types.js';
import { FileEvidenceTelemetryOutbox } from '../platform/telemetry/evidence-outbox.js';
import { safeEvidenceAttributes } from '../platform/telemetry/evidence-mapping.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

class RecoveringTelemetry implements EvidenceTelemetryPort {
  fail = true;
  readonly batches: EvidenceTelemetryBatch[] = [];

  export(batch: EvidenceTelemetryBatch): Promise<void> {
    if (this.fail) return Promise.reject(new Error('collector unavailable'));
    this.batches.push(structuredClone(batch));
    return Promise.resolve();
  }
}

describe('Evidence telemetry outbox', () => {
  it('keeps local facts on exporter failure and replays stable Run, Attempt, node, Artifact and Gate events', async () => {
    const root = await temporaryDirectory('repoctopus-evidence-telemetry-');
    cleanup.push(root);
    await createGitRepository(root, 'app');
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const config: SharedProjectConfig = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusProject',
      project: { id: 'telemetry' },
      repositories: [{ id: 'app', path: '../app' }],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'build',
              type: 'command',
              repository: 'app',
              dependsOn: [],
              required: true,
              executable: process.execPath,
              args: ['-e', "process.stdout.write('artifact body')"],
              timeoutMs: 5000,
              cache: false,
            },
          ],
        },
      ],
    };
    await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
    const telemetry = new RecoveringTelemetry();
    const runtime = new EvidenceRuntime(workspace, telemetry);

    const completed = await runtime.run('verify', 'attempt-telemetry', 'workflow-run-1');
    expect(completed.bundle.outcome).toBe('passed');
    expect(completed.telemetry).toMatchObject({ status: 'pending', exportedEvents: 0 });
    expect((await runtime.status('attempt-telemetry')).attempt.status).toBe('completed');
    expect(
      (await new FileEvidenceTelemetryOutbox(workspace).readCursor('attempt-telemetry')).offset,
    ).toBe(0);

    telemetry.fail = false;
    await runtime.resume('attempt-telemetry');
    expect(telemetry.batches).toHaveLength(1);
    const batch = telemetry.batches[0]!;
    expect(batch).toMatchObject({
      runId: 'workflow-run-1',
      attemptId: 'attempt-telemetry',
      profileId: 'verify',
    });
    expect(batch.events.map((event) => event.type)).toEqual([
      'evidence.attempt.started',
      'evidence.node.completed',
      'evidence.artifact.recorded',
      'evidence.gate.evaluated',
      'evidence.attempt.completed',
    ]);
    expect(new Set(batch.events.map((event) => event.eventId)).size).toBe(batch.events.length);
    expect(batch.events.find((event) => event.type === 'evidence.node.completed')).toMatchObject({
      data: { nodeId: 'build', receiptId: completed.receipts[0]?.receiptId },
    });
    expect(batch.events.find((event) => event.type === 'evidence.artifact.recorded')).toMatchObject(
      {
        data: { receiptId: completed.receipts[0]?.receiptId, artifactType: 'command-stdout' },
      },
    );
    expect(batch.events.find((event) => event.type === 'evidence.gate.evaluated')).toMatchObject({
      data: { bundleId: completed.bundle.bundleId, gateStatus: 'satisfied' },
    });
    const reused = structuredClone(completed);
    reused.receipts[0]!.sourceReceiptId = 'source-receipt';
    const retryBatch = createEvidenceTelemetryBatch({
      workflowRunId: 'workflow-run-1',
      result: reused,
      gate: reused.gate,
    });
    expect(
      retryBatch.events.find((event) => event.type === 'evidence.node.completed'),
    ).toMatchObject({ data: { sourceReceiptId: 'source-receipt' } });
    expect(
      (await new FileEvidenceTelemetryOutbox(workspace).readCursor('attempt-telemetry')).offset,
    ).toBe(batch.events.length);

    await runtime.resume('attempt-telemetry');
    expect(telemetry.batches).toHaveLength(1);
  });

  it('maps only allowlisted metadata and excludes arbitrary private content', () => {
    const batch: EvidenceTelemetryBatch = {
      schemaVersion: 1,
      runId: 'run',
      attemptId: 'attempt',
      profileId: 'verify',
      events: [
        {
          schemaVersion: 1,
          sequence: 1,
          eventId: 'event',
          type: 'evidence.node.completed',
          timestamp: '2026-01-01T00:00:00.000Z',
          runId: 'run',
          attemptId: 'attempt',
          data: {
            nodeId: 'build',
            status: 'passed',
            path: 'C:/private/source',
            output: 'secret command output',
            serviceLog: 'Bearer token-value-that-must-not-leak',
            healthBody: '{"password":"hidden"}',
            dom: '<html>private</html>',
            screenshot: 'raw-png-bytes',
            visualRequest: 'full visual request',
            visualResponse: 'full visual response',
          },
        },
      ],
    };
    const attributes = safeEvidenceAttributes(batch, batch.events[0]!);
    expect(attributes).toMatchObject({
      'repoctopus.run.id': 'run',
      'repoctopus.evidence.attempt.id': 'attempt',
      'repoctopus.evidence.nodeId': 'build',
      'repoctopus.evidence.status': 'passed',
    });
    expect(JSON.stringify(attributes)).not.toMatch(
      /private|secret command output|bearer|password|raw-png|visual request|visual response/iu,
    );
  });
});
