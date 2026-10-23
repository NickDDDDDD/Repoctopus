import { access, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import { mapObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import {
  DESKTOP_LOCAL_DESTINATION_ID,
  DesktopObservationDestinationProvider,
} from '../plugins/telemetry/desktop-observation-destination-provider.js';
import {
  ObservationTelemetryProvider,
  REMOTE_OTLP_DESTINATION_ID,
} from '../plugins/telemetry/observation-telemetry-provider.js';
import {
  DEFAULT_OBSERVATION_RETENTION_POLICY,
  FileObservationEnvelopeStore,
} from '../platform/telemetry/observation-envelope-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

interface CapturedRequest {
  path: string;
  authorization?: string;
  ingestionKey?: string;
  body: unknown;
}

interface TestReceiver {
  origin: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const contexts: Context[] = [];
const directories: string[] = [];
const receivers: TestReceiver[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.fiber.dispose()));
  await Promise.all(receivers.splice(0).map((receiver) => receiver.close()));
  await Promise.all(directories.splice(0).map(removeTemporaryDirectory));
});

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function receiver(requiredAuthorization?: string): Promise<TestReceiver> {
  const requests: CapturedRequest[] = [];
  let closed = false;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const authorization = request.headers.authorization;
      if (requiredAuthorization && authorization !== requiredAuthorization) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      requests.push({
        path: request.url ?? '',
        ...(authorization ? { authorization } : {}),
        ...(typeof request.headers['signoz-ingestion-key'] === 'string'
          ? { ingestionKey: request.headers['signoz-ingestion-key'] }
          : {}),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test receiver did not bind');
  const result: TestReceiver = {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server);
    },
  };
  receivers.push(result);
  return result;
}

function envelope(sequence: number) {
  return mapObservationEnvelope(
    {
      source: {
        domain: 'workflow',
        eventId: `event-telemetry-docs-${sequence}`,
        eventType: 'run.started',
        sequence,
      },
      observedAt: `2026-10-23T10:00:0${sequence}.000Z`,
      attributes: {
        'repoctopus.workspace.id': 'telemetry-docs',
        'repoctopus.change.id': 'telemetry-docs',
        'repoctopus.run.id': `run-telemetry-docs-${sequence}`,
      },
    },
    {
      allowedAttributes: ['repoctopus.workspace.id', 'repoctopus.change.id', 'repoctopus.run.id'],
      signals: [
        { kind: 'trace', name: 'repoctopus.run' },
        { kind: 'log', name: 'repoctopus.workflow.event', severity: 'info' },
        { kind: 'metric', name: 'repoctopus.workflow.events', value: 1, unit: 'event' },
      ],
    },
  );
}

function collectEnvelopeIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectEnvelopeIds(entry, ids);
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  const record = value as Record<string, unknown>;
  if (record.key === 'repoctopus.envelope.id') {
    const stringValue = (record.value as { stringValue?: unknown } | undefined)?.stringValue;
    if (typeof stringValue === 'string') ids.add(stringValue);
  }
  for (const entry of Object.values(record)) collectEnvelopeIds(entry, ids);
  return ids;
}

function receivedEnvelopeIds(requests: readonly CapturedRequest[]): string[] {
  const ids = new Set<string>();
  for (const request of requests) collectEnvelopeIds(request.body, ids);
  return [...ids].sort();
}

describe('telemetry developer documentation', () => {
  it('keeps links, commands, identities and retention defaults aligned with the implementation', async () => {
    const documentationPath = path.join(repositoryRoot, 'docs', 'telemetry.md');
    const documentation = await readFile(documentationPath, 'utf8');
    for (const requiredText of [
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
      'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
      `\`${REMOTE_OTLP_DESTINATION_ID}\``,
      `\`${DESKTOP_LOCAL_DESTINATION_ID}\``,
      'npm run desktop:prepare',
      'npm run build:desktop',
      'npm run test:telemetry-docs',
      'at-least-once',
      'exactly-once',
    ]) {
      expect(documentation).toContain(requiredText);
    }

    const reference = await readFile(
      path.join(repositoryRoot, 'docs', 'telemetry-reference.md'),
      'utf8',
    );
    for (const [source, contents] of [
      [documentationPath, documentation],
      [path.join(repositoryRoot, 'docs', 'telemetry-reference.md'), reference],
    ] as const) {
      const links = [...contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
        .map((match) => match[1]!)
        .filter((target) => !/^[a-z]+:/iu.test(target) && !target.startsWith('#'));
      for (const target of links) {
        await expect(access(path.resolve(path.dirname(source), target))).resolves.toBe(undefined);
      }
    }
    expect(reference).toContain(
      new Intl.NumberFormat('en-US').format(DEFAULT_OBSERVATION_RETENTION_POLICY.maxEnvelopes),
    );
    expect(reference).toContain('64 MiB');
    expect(reference).toContain('7 天');
    expect(reference).toContain(`${DEFAULT_OBSERVATION_RETENTION_POLICY.maxGapRecords} 条`);
  });

  it('runs remote-only, dual-destination, Desktop-offline and recovery scenarios', async () => {
    const workspace = await temporaryDirectory('repoctopus-telemetry-docs-');
    directories.push(workspace);
    const remote = await receiver();
    const observationContext = new Context();
    const desktopContext = new Context();
    contexts.push(observationContext, desktopContext);
    const observation = new ObservationTelemetryProvider(observationContext, {
      workspaceRoot: workspace,
      environment: {
        OTEL_EXPORTER_OTLP_ENDPOINT: remote.origin,
        OTEL_EXPORTER_OTLP_HEADERS: 'signoz-ingestion-key=telemetry-docs',
      },
    });
    const desktop = new DesktopObservationDestinationProvider(desktopContext, {
      workspaceRoot: workspace,
    });
    const store = new FileObservationEnvelopeStore(workspace);
    const first = envelope(1);

    // Remote-only: no local Cursor exists until a Desktop receiver activates.
    await observation.publish([first]);
    expect(receivedEnvelopeIds(remote.requests)).toEqual([first.envelopeId]);
    expect([...new Set(remote.requests.map((request) => request.path))].sort()).toEqual([
      '/v1/logs',
      '/v1/metrics',
      '/v1/traces',
    ]);
    expect(remote.requests.every((request) => request.ingestionKey === 'telemetry-docs')).toBe(
      true,
    );
    expect((await store.inspectDestination(REMOTE_OTLP_DESTINATION_ID)).backlog.envelopeCount).toBe(
      0,
    );
    await expect(
      access(
        path.join(
          workspace,
          '.repoctopus',
          'telemetry',
          'v1',
          'destinations',
          `${DESKTOP_LOCAL_DESTINATION_ID}.json`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    // Dual destination: both receivers observe the same immutable identities.
    const desktopReceiver = await receiver('Bearer telemetry-docs');
    const desktopEndpoint = {
      origin: desktopReceiver.origin,
      authorization: 'Bearer telemetry-docs',
    };
    await expect(desktop.replay(desktopEndpoint)).resolves.toEqual({ delivered: 1, pending: 0 });
    expect(
      desktopReceiver.requests.every(
        (request) => request.authorization === 'Bearer telemetry-docs',
      ),
    ).toBe(true);
    const second = envelope(2);
    await observation.publish([second]);
    await expect(desktop.replay(desktopEndpoint)).resolves.toEqual({ delivered: 1, pending: 0 });
    expect(receivedEnvelopeIds(desktopReceiver.requests)).toEqual(
      receivedEnvelopeIds(remote.requests),
    );

    // Desktop offline: remote delivery advances while the local Cursor remains pending.
    await desktopReceiver.close();
    const third = envelope(3);
    await observation.publish([third]);
    await expect(desktop.replay(desktopEndpoint)).rejects.toThrow(
      'Desktop telemetry replay failed',
    );
    expect((await store.inspectDestination(REMOTE_OTLP_DESTINATION_ID)).backlog.envelopeCount).toBe(
      0,
    );
    expect(await store.inspectDestination(DESKTOP_LOCAL_DESTINATION_ID)).toMatchObject({
      health: { status: 'degraded', consecutiveFailures: 1 },
      backlog: { envelopeCount: 1 },
    });

    // Recovery: a new local session drains only its Cursor and leaves the remote Cursor unchanged.
    const remoteCursorBefore = await store.readCursor(REMOTE_OTLP_DESTINATION_ID);
    const recoveredDesktop = await receiver('Bearer telemetry-docs-recovered');
    await expect(
      desktop.replay({
        origin: recoveredDesktop.origin,
        authorization: 'Bearer telemetry-docs-recovered',
      }),
    ).resolves.toEqual({ delivered: 1, pending: 0 });
    expect(await store.readCursor(REMOTE_OTLP_DESTINATION_ID)).toEqual(remoteCursorBefore);
    expect(await store.inspectDestination(DESKTOP_LOCAL_DESTINATION_ID)).toMatchObject({
      health: { status: 'healthy', consecutiveFailures: 0 },
      backlog: { envelopeCount: 0 },
    });
    expect(receivedEnvelopeIds(recoveredDesktop.requests)).toEqual([third.envelopeId]);
  });
});
