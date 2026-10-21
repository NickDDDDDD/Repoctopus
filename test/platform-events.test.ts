import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  acceptDelivery,
  claimDelivery,
  deliveryEnvelope,
  settleDelivery,
} from '../domains/platform-events/inbox.js';
import {
  EnvironmentWebhookCredentialProvider,
  GitHubWebhookAdapter,
  type GitHubWebhookRequest,
} from '../platform/events/github-webhook.js';
import type { WebhookRequestError } from '../platform/events/github-webhook.js';

function request(body: Uint8Array, secret = 'secret'): GitHubWebhookRequest {
  return {
    method: 'POST',
    contentType: 'application/json; charset=utf-8',
    headersDistinct: {
      'x-hub-signature-256': [`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`],
      'x-github-delivery': ['delivery-1'],
      'x-github-event': ['pull_request'],
    },
    body,
  };
}

function adapter(
  secret: () => Promise<string> = () => Promise.resolve('secret'),
  maxBodyBytes = 1024,
) {
  return new GitHubWebhookAdapter({ secret }, { source: 'primary', maxBodyBytes });
}

describe('platform event ingress and inbox', () => {
  it('resolves the webhook credential, verifies GitHub, and preserves the payload envelope', async () => {
    const body = Buffer.from('{"action":"closed","number":2}');
    const credentialCalls: string[] = [];
    const envelope = await adapter(() => {
      credentialCalls.push('secret');
      return Promise.resolve('secret');
    }).verify(request(body), '2026-10-20T00:00:00.000Z');
    expect(envelope).toMatchObject({
      provider: 'github',
      source: 'primary',
      deliveryId: 'delivery-1',
      eventType: 'pull_request',
      payload: { action: 'closed', number: 2 },
    });
    expect(credentialCalls).toEqual(['secret']);
  });

  it.each([
    ['method', { method: 'GET' }, 405],
    ['content type', { contentType: 'text/plain' }, 415],
    ['size', { body: Buffer.alloc(20) }, 413],
  ])('rejects invalid %s before resolving a credential', async (_name, override, status) => {
    const body = Buffer.from('{}');
    const base = request(body);
    const credentialCalls: string[] = [];
    await expect(
      adapter(() => {
        credentialCalls.push('secret');
        return Promise.resolve('secret');
      }, 10).verify({ ...base, ...override }, '2026-10-20T00:00:00.000Z'),
    ).rejects.toEqual(expect.objectContaining({ status }) as WebhookRequestError);
    expect(credentialCalls).toEqual([]);
  });

  it.each(['x-hub-signature-256', 'x-github-delivery', 'x-github-event'])(
    'requires exactly one %s header before resolving a credential',
    async (name) => {
      const body = Buffer.from('{}');
      const base = request(body);
      for (const value of [undefined, ['first', 'second']]) {
        const credentials: string[] = [];
        await expect(
          adapter(() => {
            credentials.push('secret');
            return Promise.resolve('secret');
          }).verify(
            { ...base, headersDistinct: { ...base.headersDistinct, [name]: value } },
            '2026-10-20T00:00:00.000Z',
          ),
        ).rejects.toEqual(expect.objectContaining({ status: 400 }) as WebhookRequestError);
        expect(credentials).toEqual([]);
      }
    },
  );

  it('maps an unavailable credential to a retryable error without leaking its cause', async () => {
    const body = Buffer.from('{}');
    const failure = await adapter(() => Promise.reject(new Error('vault exposed-secret-value')))
      .verify(request(body), '2026-10-20T00:00:00.000Z')
      .catch((error: unknown) => error);
    expect(failure).toEqual(
      expect.objectContaining({
        status: 503,
        message: 'GitHub webhook secret is unavailable',
      }) as WebhookRequestError,
    );
    expect(String(failure)).not.toContain('exposed-secret-value');
  });

  it('verifies the signature before parsing the JSON payload', async () => {
    const invalidJson = Buffer.from('{');
    await expect(
      adapter().verify(request(invalidJson, 'different-secret'), '2026-10-20T00:00:00.000Z'),
    ).rejects.toEqual(expect.objectContaining({ status: 401 }) as WebhookRequestError);
    await expect(
      adapter().verify(request(invalidJson), '2026-10-20T00:00:00.000Z'),
    ).rejects.toEqual(expect.objectContaining({ status: 400 }) as WebhookRequestError);
  });

  it('reads an exact webhook secret from the configured environment variable', async () => {
    const provider = new EnvironmentWebhookCredentialProvider(
      { REPOCTOPUS_GITHUB_WEBHOOK_SECRET: ' exact secret ' },
      'REPOCTOPUS_GITHUB_WEBHOOK_SECRET',
    );
    await expect(provider.secret()).resolves.toBe(' exact secret ');
    await expect(
      new EnvironmentWebhookCredentialProvider({}, 'REPOCTOPUS_GITHUB_WEBHOOK_SECRET').secret(),
    ).rejects.toThrow('GitHub webhook secret is unavailable');
  });

  it('deduplicates, leases, recovers an expired lease, retries, and completes once', () => {
    const envelope = deliveryEnvelope({
      provider: 'github',
      source: 'primary',
      deliveryId: 'delivery-1',
      eventType: 'pull_request',
      receivedAt: '2026-10-20T00:00:00.000Z',
      payload: { action: 'closed' },
    });
    const accepted = acceptDelivery(envelope, '2026-10-20T00:00:00.000Z');
    expect(acceptDelivery(envelope, '2026-10-20T00:00:01.000Z', accepted.entry).duplicate).toBe(
      true,
    );
    const first = claimDelivery({
      entry: accepted.entry,
      owner: 'runner-a',
      token: 'lease-a',
      timestamp: '2026-10-20T00:00:01.000Z',
      leaseMs: 1000,
    })!;
    expect(
      claimDelivery({
        entry: first,
        owner: 'runner-b',
        timestamp: '2026-10-20T00:00:01.500Z',
        leaseMs: 1000,
      }),
    ).toBeNull();
    const recovered = claimDelivery({
      entry: first,
      owner: 'runner-b',
      token: 'lease-b',
      timestamp: '2026-10-20T00:00:03.000Z',
      leaseMs: 1000,
    })!;
    const retry = settleDelivery({
      entry: recovered,
      leaseToken: 'lease-b',
      timestamp: '2026-10-20T00:00:03.100Z',
      result: 'retry',
      retryAt: '2026-10-20T00:00:05.000Z',
    });
    expect(
      claimDelivery({
        entry: retry.entry,
        owner: 'runner-c',
        timestamp: '2026-10-20T00:00:04.000Z',
        leaseMs: 1000,
      }),
    ).toBeNull();
    const finalClaim = claimDelivery({
      entry: retry.entry,
      owner: 'runner-c',
      token: 'lease-c',
      timestamp: '2026-10-20T00:00:05.000Z',
      leaseMs: 1000,
    })!;
    const completed = settleDelivery({
      entry: finalClaim,
      leaseToken: 'lease-c',
      timestamp: '2026-10-20T00:00:05.100Z',
      result: 'completed',
    });
    expect(completed.entry.status).toBe('completed');
    expect(
      claimDelivery({
        entry: completed.entry,
        owner: 'runner-d',
        timestamp: '2026-10-20T00:00:06.000Z',
        leaseMs: 1000,
      }),
    ).toBeNull();
  });
});
