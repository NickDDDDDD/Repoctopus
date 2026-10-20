import { createHmac, timingSafeEqual } from 'node:crypto';

import { deliveryEnvelope } from '../../domains/platform-events/inbox.js';
import type { PlatformDeliveryEnvelope } from '../../domains/platform-events/types.js';

export class WebhookRequestError extends Error {
  constructor(
    readonly status: 400 | 401 | 405 | 413 | 415 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookRequestError';
  }
}

export interface GitHubWebhookRequest {
  method: string;
  contentType?: string;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Uint8Array;
}

function oneHeader(request: GitHubWebhookRequest, name: string): string {
  const raw = request.headers[name];
  const values = typeof raw === 'string' ? [raw] : raw;
  if (!values || values.length !== 1 || !values[0]?.trim()) {
    throw new WebhookRequestError(400, `missing ${name} header`);
  }
  return values[0];
}

function jsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(';').map((item) => item.trim());
  if (parts[0]?.toLowerCase() !== 'application/json') return false;
  return (
    parts.length === 1 || (parts.length === 2 && /^charset=(?:utf-8|"utf-8")$/iu.test(parts[1]!))
  );
}

function parsePayload(body: Uint8Array): PlatformDeliveryEnvelope['payload'] {
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    value = JSON.parse(text) as unknown;
  } catch {
    throw new WebhookRequestError(400, 'request body is not valid UTF-8 JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebhookRequestError(400, 'GitHub webhook payload must be a JSON object');
  }
  return structuredClone(value) as PlatformDeliveryEnvelope['payload'];
}

export function verifyGitHubWebhook(input: {
  request: GitHubWebhookRequest;
  source: string;
  secret: string | undefined;
  maxBodyBytes: number;
  receivedAt: string;
}): PlatformDeliveryEnvelope {
  if (input.request.method !== 'POST') throw new WebhookRequestError(405, 'method not allowed');
  if (!jsonContentType(input.request.contentType)) {
    throw new WebhookRequestError(415, 'content type must be application/json');
  }
  if (input.request.body.byteLength > input.maxBodyBytes) {
    throw new WebhookRequestError(413, 'request body is too large');
  }
  const signature = oneHeader(input.request, 'x-hub-signature-256');
  const deliveryId = oneHeader(input.request, 'x-github-delivery');
  const eventType = oneHeader(input.request, 'x-github-event');
  if (!input.secret) throw new WebhookRequestError(503, 'GitHub webhook secret is unavailable');
  const expected = `sha256=${createHmac('sha256', input.secret).update(input.request.body).digest('hex')}`;
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    throw new WebhookRequestError(401, 'invalid webhook signature');
  }
  return deliveryEnvelope({
    provider: 'github',
    source: input.source,
    deliveryId,
    eventType,
    receivedAt: input.receivedAt,
    payload: parsePayload(input.request.body),
  });
}
