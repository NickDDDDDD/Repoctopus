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
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      target.push(...decodeObservationOtlpJson(Buffer.concat(chunks)));
      response.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('mock receiver failed');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
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
});
