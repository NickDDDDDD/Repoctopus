import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { decodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';
import { DesktopLauncher } from '../services/desktop-launcher.js';
import { ObservationDelivery } from '../services/observation-delivery.js';

function envelope(): ObservationEnvelope {
  return {
    schemaVersion: 1,
    envelopeId: `sha256:${'1'.repeat(64)}`,
    digest: `sha256:${'2'.repeat(64)}`,
    observedAt: '2026-10-28T00:00:00.000Z',
    eventType: 'run.started',
    identity: { eventId: 'event-1', runId: 'run-1', sequence: 1 },
    correlation: { workspaceId: 'team-platform', changeId: 'dashboard' },
    attributes: {},
  };
}

async function receiver(target: ObservationEnvelope[]) {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? '');
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      for (const envelope of decodeObservationOtlpJson(Buffer.concat(chunks))) {
        if (!target.some((item) => item.envelopeId === envelope.envelopeId)) target.push(envelope);
      }
      response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('mock receiver failed');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    paths,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('desktop observation delivery slice', () => {
  it('replays one canonical envelope independently to local and remote OTLP destinations', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-delivery-'));
    const remote: ObservationEnvelope[] = [];
    const desktop: ObservationEnvelope[] = [];
    const remoteServer = await receiver(remote);
    const desktopServer = await receiver(desktop);
    const context = new Context();
    try {
      const delivery = new ObservationDelivery(context, { workspaceRoot: directory });
      await delivery.append([envelope()]);
      expect(
        await delivery.replay({ id: 'remote', endpoint: remoteServer.endpoint }),
      ).toMatchObject({
        delivered: 1,
      });
      expect(
        await delivery.replay({ id: 'desktop', endpoint: desktopServer.endpoint }),
      ).toMatchObject({ delivered: 1 });
      expect(remote).toEqual([envelope()]);
      expect(desktop).toEqual(remote);
      expect(new Set(remoteServer.paths)).toEqual(
        new Set(['/v1/traces', '/v1/logs', '/v1/metrics']),
      );
      expect(new Set(desktopServer.paths)).toEqual(
        new Set(['/v1/traces', '/v1/logs', '/v1/metrics']),
      );

      const failed = await delivery.replay({ id: 'offline', endpoint: 'http://127.0.0.1:1' });
      expect(failed).toMatchObject({ delivered: 0 });
      expect(failed.warning).toBeTruthy();
      const launcher = new DesktopLauncher(context, { environment: {} });
      const launch = launcher.activate({
        schemaVersion: 1,
        workspaceId: 'team-platform',
        changeId: 'dashboard',
        runId: 'run-1',
      });
      expect(launch.status).toBe('unavailable');
      expect(typeof launch.warning).toBe('string');
    } finally {
      await Promise.all([remoteServer.close(), desktopServer.close()]);
      await context.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('isolates destination failures and preserves health while destinations pause or are removed', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-delivery-health-'));
    const received: ObservationEnvelope[] = [];
    const healthy = await receiver(received);
    const context = new Context();
    try {
      const delivery = new ObservationDelivery(context, { workspaceRoot: directory });
      await delivery.append([envelope()]);
      const results = await delivery.replayAll([
        { id: 'remote', endpoint: healthy.endpoint },
        { id: 'desktop', endpoint: 'http://127.0.0.1:1' },
      ]);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ destinationId: 'remote', delivered: 1 }),
          expect.objectContaining({ destinationId: 'desktop', delivered: 0 }),
        ]),
      );
      expect(await delivery.health('remote')).toMatchObject({ backlog: 0 });
      expect(await delivery.health('desktop')).toMatchObject({
        backlog: 1,
        lastAttempt: { result: 'failed' },
      });

      await delivery.setMode('desktop', 'paused');
      expect(await delivery.replay({ id: 'desktop', endpoint: healthy.endpoint })).toMatchObject({
        delivered: 0,
        skipped: 'paused',
      });
      await delivery.setMode('desktop', 'removed');
      expect(await delivery.health('desktop')).toMatchObject({ mode: 'removed', backlog: 0 });
    } finally {
      await healthy.close();
      await context.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
