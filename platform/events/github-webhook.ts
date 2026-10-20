import { createHmac, timingSafeEqual } from 'node:crypto';

import { deliveryEnvelope } from '../../domains/platform-events/inbox.js';
import type {
  PlatformWebhookAdapter,
  PlatformWebhookRequest,
  WebhookCredentialProvider,
} from '../../domains/platform-events/ports.js';
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

export type GitHubWebhookRequest = PlatformWebhookRequest;

export interface GitHubWebhookAdapterOptions {
  source: string;
  maxBodyBytes: number;
}

interface GitHubWebhookHeaders {
  signature: string;
  deliveryId: string;
  eventType: string;
}

function oneHeader(request: GitHubWebhookRequest, name: string): string {
  const values = request.headersDistinct[name];
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

function inspectRequest(
  request: GitHubWebhookRequest,
  maxBodyBytes: number,
): GitHubWebhookHeaders {
  if (request.method !== 'POST') throw new WebhookRequestError(405, 'method not allowed');
  if (!jsonContentType(request.contentType)) {
    throw new WebhookRequestError(415, 'content type must be application/json');
  }
  if (request.body.byteLength > maxBodyBytes) {
    throw new WebhookRequestError(413, 'request body is too large');
  }
  return {
    signature: oneHeader(request, 'x-hub-signature-256'),
    deliveryId: oneHeader(request, 'x-github-delivery'),
    eventType: oneHeader(request, 'x-github-event'),
  };
}

function authenticatedEnvelope(input: {
  request: GitHubWebhookRequest;
  headers: GitHubWebhookHeaders;
  source: string;
  secret: string;
  receivedAt: string;
}): PlatformDeliveryEnvelope {
  const expected = `sha256=${createHmac('sha256', input.secret).update(input.request.body).digest('hex')}`;
  const receivedBytes = Buffer.from(input.headers.signature);
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
    deliveryId: input.headers.deliveryId,
    eventType: input.headers.eventType,
    receivedAt: input.receivedAt,
    payload: parsePayload(input.request.body),
  });
}

export class GitHubWebhookAdapter implements PlatformWebhookAdapter {
  constructor(
    private readonly credentials: WebhookCredentialProvider,
    private readonly options: GitHubWebhookAdapterOptions,
  ) {}

  async verify(
    request: GitHubWebhookRequest,
    receivedAt: string,
  ): Promise<PlatformDeliveryEnvelope> {
    const headers = inspectRequest(request, this.options.maxBodyBytes);
    let secret: string;
    try {
      secret = await this.credentials.secret();
    } catch {
      throw new WebhookRequestError(503, 'GitHub webhook secret is unavailable');
    }
    if (!secret) throw new WebhookRequestError(503, 'GitHub webhook secret is unavailable');
    return authenticatedEnvelope({
      request,
      headers,
      source: this.options.source,
      secret,
      receivedAt,
    });
  }
}

export class EnvironmentWebhookCredentialProvider implements WebhookCredentialProvider {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly variable = 'GITHUB_WEBHOOK_SECRET',
  ) {}

  secret(): Promise<string> {
    const value = this.environment[this.variable];
    return value
      ? Promise.resolve(value)
      : Promise.reject(new Error('GitHub webhook secret is unavailable'));
  }
}
