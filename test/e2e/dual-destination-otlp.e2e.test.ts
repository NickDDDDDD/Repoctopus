import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { decodeObservationOtlpJson } from '../../app/desktop/host/otlp-envelope-codec.js';
import { DesktopOtlpHttpReceiver } from '../../app/desktop/host/otlp-http-receiver.js';
import { WorkflowRunCoordinator } from '../../domains/runtime/workflow-runs.js';
import type { ObservationEnvelope } from '../../domains/trajectory/observation.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import { ObservationDelivery } from '../../services/observation-delivery.js';
import { WorkflowObservationTelemetry } from '../../services/observation-telemetry.js';
import { compositionFixture, projectFixture, workflowFixture } from '../helpers/fixtures.js';

async function remoteReceiver(target: Map<string, ObservationEnvelope>) {
  let status = 200;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (status === 200) {
        for (const envelope of decodeObservationOtlpJson(Buffer.concat(chunks))) {
          target.set(envelope.envelopeId, envelope);
        }
      }
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('remote mock did not bind');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    fail(next: boolean) {
      status = next ? 503 : 200;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('real Run dual-destination OTLP delivery', () => {
  it('preserves envelope identity and isolates either destination failure', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-dual-destination-'));
    const context = new Context();
    const remoteEnvelopes = new Map<string, ObservationEnvelope>();
    const desktopEnvelopes = new Map<string, ObservationEnvelope>();
    const remote = await remoteReceiver(remoteEnvelopes);
    const token = 'desktop-e2e-session-token-that-is-long-enough';
    const desktop = new DesktopOtlpHttpReceiver({
      sessionToken: token,
      onExport(exported) {
        for (const envelope of decodeObservationOtlpJson(exported.body)) {
          desktopEnvelopes.set(envelope.envelopeId, envelope);
        }
      },
    });
    const desktopEndpoint = await desktop.start();
    const environment = {
      OTEL_EXPORTER_OTLP_ENDPOINT: remote.endpoint,
      REPOCTOPUS_DESKTOP_OTLP_ENDPOINT: desktopEndpoint,
      REPOCTOPUS_DESKTOP_OTLP_TOKEN: token,
    };
    const delivery = new ObservationDelivery(context, { workspaceRoot: directory });
    const telemetry = new WorkflowObservationTelemetry(delivery, environment);
    const runtime = new WorkflowRunCoordinator(
      new FileRuntimeStore(path.join(directory, 'runtime')),
      telemetry,
      compositionFixture(),
    );

    try {
      const started = await runtime.start({
        workflow: workflowFixture(),
        projectSnapshot: projectFixture(),
        runId: 'run-dual-destination-e2e',
      });
      expect(started.value.state.runId).toBe('run-dual-destination-e2e');
      expect([...remoteEnvelopes.keys()].sort()).toEqual([...desktopEnvelopes.keys()].sort());
      expect(remoteEnvelopes.size).toBeGreaterThan(0);

      remote.fail(true);
      const proposed = await runtime.next('run-dual-destination-e2e');
      expect(proposed.value.state.pendingActionId).toBeTruthy();
      expect((await delivery.health('remote')).lastAttempt?.result).toBe('failed');
      expect((await delivery.health('desktop')).lastAttempt?.result).toBe('succeeded');
      const desktopAfterRemoteFailure = desktopEnvelopes.size;

      remote.fail(false);
      await desktop.stop();
      await runtime.record({
        runId: 'run-dual-destination-e2e',
        actionId: proposed.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'dual destination e2e action',
      });
      expect((await delivery.health('remote')).lastAttempt?.result).toBe('succeeded');
      expect((await delivery.health('desktop')).lastAttempt?.result).toBe('failed');
      expect(remoteEnvelopes.size).toBeGreaterThan(0);
      expect(desktopEnvelopes.size).toBe(desktopAfterRemoteFailure);
      expect((await runtime.status('run-dual-destination-e2e')).state.status).not.toBe('failed');

      const commonIds = [...desktopEnvelopes.keys()].filter((id) => remoteEnvelopes.has(id));
      expect(commonIds.length).toBeGreaterThan(0);
      for (const id of commonIds) expect(remoteEnvelopes.get(id)).toEqual(desktopEnvelopes.get(id));
    } finally {
      await desktop.stop();
      await remote.close();
      await context.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
