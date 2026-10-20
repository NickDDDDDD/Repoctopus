import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  acceptDelivery,
  claimDelivery,
  deliveryEnvelope,
  settleDelivery,
} from '../domains/platform-events/inbox.js';
import {
  verifyGitHubWebhook,
  type GitHubWebhookRequest,
} from '../platform/events/github-webhook.js';
import type { WebhookRequestError } from '../platform/events/github-webhook.js';

function request(body: Uint8Array, secret = 'secret'): GitHubWebhookRequest {
  return {
    method: 'POST',
    contentType: 'application/json; charset=utf-8',
    headers: {
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      'x-github-delivery': 'delivery-1',
      'x-github-event': 'pull_request',
    },
    body,
  };
}

describe('platform event ingress and inbox', () => {
  it('verifies GitHub before parsing and preserves a lossless payload envelope', () => {
    const body = Buffer.from('{"action":"closed","number":2}');
    const envelope = verifyGitHubWebhook({
      request: request(body),
      source: 'primary',
      secret: 'secret',
      maxBodyBytes: 1024,
      receivedAt: '2026-10-20T00:00:00.000Z',
    });
    expect(envelope).toMatchObject({
      provider: 'github',
      source: 'primary',
      deliveryId: 'delivery-1',
      eventType: 'pull_request',
      payload: { action: 'closed', number: 2 },
    });
  });

  it.each([
    ['method', { method: 'GET' }, 405],
    ['content type', { contentType: 'text/plain' }, 415],
    ['size', { body: Buffer.alloc(20) }, 413],
    ['signature', { headers: { 'x-hub-signature-256': 'sha256=bad' } }, 401],
  ])('rejects invalid %s before producing an envelope', (_name, override, status) => {
    const body = Buffer.from('{}');
    const base = request(body);
    const headers =
      'headers' in override
        ? { ...base.headers, ...(override.headers as Record<string, string>) }
        : base.headers;
    expect(() =>
      verifyGitHubWebhook({
        request: { ...base, ...override, headers },
        source: 'primary',
        secret: 'secret',
        maxBodyBytes: 10,
        receivedAt: '2026-10-20T00:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ status }) as WebhookRequestError);
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
