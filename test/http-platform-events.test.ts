import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Context, type Plugin } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import { bootApp } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import { PLUGIN_CONTRACT_VERSION } from '../app/boot/descriptor.js';
import type { EventInboxStore } from '../domains/platform-events/ports.js';
import { FileEventInboxStore } from '../platform/events/file-event-inbox-store.js';
import { GitHubWebhookAdapter } from '../platform/events/github-webhook.js';
import { GitHubWebhookRoute } from '../platform/events/github-webhook-route.js';
import githubWebhookContributor from '../plugins/events/github-webhook-contributor.js';
import { FilePlatformEventsProvider } from '../plugins/events/file-platform-events-provider.js';
import { NodeHttpHostProvider } from '../plugins/http/node-http-host-provider.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { PlatformEvents } from '../services/platform-events.js';

const workspaces: string[] = [];
const contexts: Context[] = [];

class TestPlatformEvents extends PlatformEvents {
  constructor(
    context: Context,
    protected readonly inbox: EventInboxStore,
  ) {
    super(context);
  }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.fiber.dispose()));
  await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-http-events-'));
  workspaces.push(root);
  return root;
}

function signedHeaders(body: Uint8Array, deliveryId = 'delivery-1') {
  return {
    'content-type': 'application/json',
    'x-github-delivery': deliveryId,
    'x-github-event': 'pull_request',
    'x-hub-signature-256': `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`,
  };
}

function send(input: {
  url: URL;
  method?: string;
  headers?: OutgoingHttpHeaders;
  body?: Uint8Array;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      input.url,
      { method: input.method ?? 'POST', headers: input.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    request.on('error', reject);
    request.end(input.body);
  });
}

async function ingress(
  root: string,
  options: {
    secret?: () => Promise<string>;
    maxBodyBytes?: number;
    inbox?: EventInboxStore;
  } = {},
) {
  const context = new Context();
  contexts.push(context);
  const host = new NodeHttpHostProvider(context, { hostname: '127.0.0.1', port: 0 });
  const events = new TestPlatformEvents(context, options.inbox ?? new FileEventInboxStore(root));
  const maxBodyBytes = options.maxBodyBytes ?? 1024;
  host.register(
    new GitHubWebhookRoute({
      adapter: new GitHubWebhookAdapter(
        { secret: options.secret ?? (() => Promise.resolve('secret')) },
        { source: 'primary', maxBodyBytes },
      ),
      events,
      maxBodyBytes,
      now: () => new Date('2026-10-20T00:00:00.000Z'),
    }),
  );
  await host.ready();
  return host;
}

describe('HTTP platform event ingress', () => {
  it('returns 202 only after a signed delivery is durably stored', async () => {
    const root = await workspace();
    const body = Buffer.from('{"action":"closed","number":2}');
    const host = await ingress(root);

    const response = await send({
      url: new URL('/webhooks/github', host.origin()),
      headers: signedHeaders(body),
      body,
    });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ accepted: true, duplicate: false });
    const envelopeId = (response.body as { envelopeId: string }).envelopeId;
    expect(envelopeId).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(new FileEventInboxStore(root).load(envelopeId)).resolves.toMatchObject({
      status: 'pending',
      envelope: {
        deliveryId: 'delivery-1',
        eventType: 'pull_request',
        payload: { action: 'closed', number: 2 },
      },
    });
  });

  it('rejects an oversized body before resolving credentials or buffering it for the Adapter', async () => {
    const root = await workspace();
    const body = Buffer.from('{"padding":"too-large"}');
    const credentialCalls: string[] = [];
    const host = await ingress(root, {
      maxBodyBytes: 8,
      secret: () => {
        credentialCalls.push('secret');
        return Promise.resolve('secret');
      },
    });

    const response = await send({
      url: new URL('/webhooks/github', host.origin()),
      headers: signedHeaders(body),
      body,
    });

    expect(response).toEqual({ status: 413, body: { error: 'request body is too large' } });
    expect(credentialCalls).toEqual([]);
  });

  it('preserves duplicate wire headers so the Adapter rejects them before credentials', async () => {
    const root = await workspace();
    const body = Buffer.from('{}');
    const credentialCalls: string[] = [];
    const host = await ingress(root, {
      secret: () => {
        credentialCalls.push('secret');
        return Promise.resolve('secret');
      },
    });

    const response = await send({
      url: new URL('/webhooks/github', host.origin()),
      headers: {
        ...signedHeaders(body),
        'x-github-delivery': ['delivery-1', 'delivery-2'],
      },
      body,
    });

    expect(response).toEqual({
      status: 400,
      body: { error: 'missing x-github-delivery header' },
    });
    expect(credentialCalls).toEqual([]);
  });

  it.each(['afterJournalWritten', 'afterStateWritten'] as const)(
    'returns a retryable failure at %s and recovers the same delivery on retry',
    async (failurePoint) => {
      const root = await workspace();
      const body = Buffer.from('{"action":"closed"}');
      let interrupted = false;
      const inbox = new FileEventInboxStore(root, {
        [failurePoint]: () => {
          if (interrupted) return;
          interrupted = true;
          throw new Error(`simulated interruption:${failurePoint}`);
        },
      });
      const host = await ingress(root, { inbox });
      const submit = () =>
        send({
          url: new URL('/webhooks/github', host.origin()),
          headers: signedHeaders(body),
          body,
        });

      await expect(submit()).resolves.toEqual({
        status: 503,
        body: { error: 'Event Inbox is unavailable' },
      });
      const retry = await submit();
      expect(retry.status).toBe(202);
      expect(retry.body).toMatchObject({ accepted: true, duplicate: true });
      const envelopeId = (retry.body as { envelopeId: string }).envelopeId;
      expect(envelopeId).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(new FileEventInboxStore(root).load(envelopeId)).resolves.toMatchObject({
        status: 'pending',
        stateVersion: 0,
        envelope: { deliveryId: 'delivery-1' },
      });
    },
  );

  it('returns a non-retryable conflict when a Delivery ID is reused with another payload', async () => {
    const root = await workspace();
    const host = await ingress(root);
    const first = Buffer.from('{"action":"opened"}');
    const changed = Buffer.from('{"action":"closed"}');
    const submit = (body: Uint8Array) =>
      send({
        url: new URL('/webhooks/github', host.origin()),
        headers: signedHeaders(body),
        body,
      });

    await expect(submit(first)).resolves.toMatchObject({ status: 202 });
    await expect(submit(changed)).resolves.toEqual({
      status: 409,
      body: { error: 'Delivery ID conflicts with the persisted payload' },
    });
  });

  it('registers and removes the GitHub route with the Contributor lifecycle', async () => {
    const root = await workspace();
    const context = new Context();
    contexts.push(context);
    const host = new NodeHttpHostProvider(context, { hostname: '127.0.0.1', port: 0 });
    new FilePlatformEventsProvider(context, { workspaceRoot: root });
    const contributor = context.plugin(githubWebhookContributor, {
      environment: { GITHUB_WEBHOOK_SECRET: 'secret' },
      source: 'primary',
      maxBodyBytes: 1024,
      now: () => new Date('2026-10-20T00:00:00.000Z'),
    });
    await contributor;
    await host.ready();
    const body = Buffer.from('{}');
    const submit = () =>
      send({
        url: new URL('/webhooks/github', host.origin()),
        headers: signedHeaders(body),
        body,
      });

    await expect(submit()).resolves.toMatchObject({ status: 202 });
    await contributor.dispose();
    await expect(submit()).resolves.toEqual({ status: 404, body: { error: 'route not found' } });
  });

  it('boots the HTTP Host and GitHub Route from the shipped plugin catalog', async () => {
    const root = await workspace();
    const productRoot = path.resolve(import.meta.dirname, '..');
    const catalog = await createRepoctopusBuiltinCatalog(productRoot);
    const composition = compileComposition(
      {
        id: 'platform-event-ingress',
        kind: 'project',
        plugins: [
          { id: 'http-host', config: { hostname: '127.0.0.1', port: 0 } },
          { id: 'platform-events-file', config: { workspaceRoot: root } },
          {
            id: 'github-webhook-route',
            config: {
              environment: { GITHUB_WEBHOOK_SECRET: 'secret' },
              source: 'primary',
              maxBodyBytes: 1024,
            },
          },
        ],
        requiredServices: ['httpHost', 'platformEvents'],
      },
      catalog,
    );
    const app = await bootApp({ composition, catalog });
    try {
      await app.context.httpHost.ready();
      const body = Buffer.from('{}');
      await expect(
        send({
          url: new URL('/webhooks/github', app.context.httpHost.origin()),
          headers: signedHeaders(body, 'catalog-delivery'),
          body,
        }),
      ).resolves.toMatchObject({ status: 202 });
      const accepted = await app.context.platformEvents.claimDue({
        owner: 'catalog-test',
        timestamp: new Date(Date.now() + 1).toISOString(),
        leaseMs: 1_000,
      });
      expect(accepted).toMatchObject({ envelope: { deliveryId: 'catalog-delivery' } });
    } finally {
      await app.close();
    }
  });

  it('bounds shutdown of an active request and records client-retry recovery', async () => {
    const productRoot = path.resolve(import.meta.dirname, '..');
    let routeEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      routeEntered = resolve;
    });
    const blockingRoute = Object.assign(
      ((context: Context) => {
        context.effect(() =>
          context.httpHost.register({
            path: '/hold',
            maxBodyBytes: 16,
            drainTimeoutRecoverability: 'client_retry',
            handle: () => {
              routeEntered();
              return new Promise(() => undefined);
            },
          }),
        );
      }) as Plugin,
      { inject: ['httpHost'] },
    );
    const catalog = new Map(await createRepoctopusBuiltinCatalog(productRoot));
    catalog.set('blocking-route', {
      descriptor: {
        id: 'blocking-route',
        version: '1.0.0',
        contractVersion: PLUGIN_CONTRACT_VERSION,
        configSchemaVersion: '1',
        kind: 'contributor',
        source: 'builtin',
        codeDigest: `sha256:${'f'.repeat(64)}`,
        compositions: ['project'],
        authorities: [],
        permissions: [],
        stateSchemas: {},
      },
      plugin: blockingRoute,
    });
    const composition = compileComposition(
      {
        id: 'bounded-http-shutdown',
        kind: 'project',
        plugins: [
          {
            id: 'http-host',
            config: { hostname: '127.0.0.1', port: 0, shutdownTimeoutMs: 20 },
          },
          { id: 'blocking-route' },
        ],
        requiredServices: ['httpHost'],
      },
      catalog,
    );
    const app = await bootApp({ composition, catalog });
    await app.context.httpHost.ready();
    const url = new URL(app.context.httpHost.origin());
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    socket.on('error', () => undefined);
    await once(socket, 'connect');
    await new Promise<void>((resolve, reject) => {
      socket.write(
        [
          'POST /hold HTTP/1.1',
          `Host: ${url.host}`,
          'Content-Type: application/json',
          'Content-Length: 2',
          '',
          '{}',
        ].join('\r\n'),
        (error) => (error ? reject(error) : resolve()),
      );
    });
    await entered;

    const startedAt = Date.now();
    const socketClosed = once(socket, 'close');
    await app.close();
    await socketClosed;
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(app.lifecycleDiagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OPERATION_DRAIN_TIMEOUT',
        service: 'httpHost',
        recoverability: 'client_retry',
      }),
    );
    expect(socket.destroyed).toBe(true);
  });
});
