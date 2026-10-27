import { afterEach, describe, expect, it } from 'vitest';

import {
  DesktopOtlpHttpReceiver,
  type DesktopReceiverDiagnostic,
} from '../app/desktop/host/otlp-http-receiver.js';

const receivers: DesktopOtlpHttpReceiver[] = [];
afterEach(async () => Promise.all(receivers.splice(0).map((receiver) => receiver.stop())));

async function start(options: {
  maxBodyBytes?: number;
  diagnostics?: DesktopReceiverDiagnostic[];
}) {
  const exports: Array<{ signal: string; body: Uint8Array }> = [];
  const receiver = new DesktopOtlpHttpReceiver({
    sessionToken: 'test-session-token-with-enough-entropy',
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    onExport: (record) => {
      exports.push({ signal: record.signal, body: record.body });
    },
    onDiagnostic: (diagnostic) => {
      options.diagnostics?.push(diagnostic);
    },
  });
  receivers.push(receiver);
  const endpoint = await receiver.start();
  return { receiver, endpoint, exports };
}

async function request(
  endpoint: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    contentType?: string;
    body?: string | Uint8Array;
  } = {},
): Promise<Response> {
  return fetch(`${endpoint}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      ...(options.token === undefined ? {} : { 'x-repoctopus-session': options.token }),
      ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }),
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

describe('Desktop Host OTLP/HTTP receiver', () => {
  it.each([
    ['/v1/traces', 'trace'],
    ['/v1/logs', 'log'],
    ['/v1/metrics', 'metric'],
  ])('accepts authenticated protobuf %s without polling', async (path, signal) => {
    const { receiver, endpoint, exports } = await start({});
    const response = await request(endpoint, path, {
      token: 'test-session-token-with-enough-entropy',
      contentType: 'application/x-protobuf',
      body: new Uint8Array([10, 0]),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({ signal });
    expect(receiver.snapshot()).toMatchObject({
      host: '127.0.0.1',
      endpoint,
      acceptedCount: 1,
      rejectedCount: 0,
    });
  });

  it('accepts structurally valid OTLP JSON and rejects malformed JSON', async () => {
    const diagnostics: DesktopReceiverDiagnostic[] = [];
    const { endpoint, exports } = await start({ diagnostics });
    const accepted = await request(endpoint, '/v1/traces', {
      token: 'test-session-token-with-enough-entropy',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ resourceSpans: [] }),
    });
    const rejected = await request(endpoint, '/v1/traces', {
      token: 'test-session-token-with-enough-entropy',
      contentType: 'application/json',
      body: '{private malformed payload',
    });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toBe('');
    expect(exports).toHaveLength(1);
    expect(diagnostics.at(-1)).toMatchObject({ result: 'rejected', reason: 'malformed-body' });
    expect(JSON.stringify(diagnostics)).not.toContain('private malformed payload');
  });

  it('rejects an empty request body as malformed', async () => {
    const diagnostics: DesktopReceiverDiagnostic[] = [];
    const { endpoint, exports } = await start({ diagnostics });
    const response = await request(endpoint, '/v1/metrics', {
      token: 'test-session-token-with-enough-entropy',
      contentType: 'application/x-protobuf',
      body: new Uint8Array(),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(exports).toEqual([]);
    expect(diagnostics.at(-1)).toMatchObject({ result: 'rejected', reason: 'malformed-body' });
  });

  it.each([
    ['unauthorized', {}, 401, 'unauthorized'],
    [
      'wrong method',
      {
        method: 'PUT',
        token: 'test-session-token-with-enough-entropy',
        contentType: 'application/x-protobuf',
      },
      405,
      'method-not-allowed',
    ],
    [
      'wrong content type',
      {
        token: 'test-session-token-with-enough-entropy',
        contentType: 'text/plain',
        body: 'private body',
      },
      415,
      'unsupported-content-type',
    ],
  ] as const)(
    'rejects %s with a body-free bounded diagnostic',
    async (_label, options, status, reason) => {
      const diagnostics: DesktopReceiverDiagnostic[] = [];
      const { endpoint, exports } = await start({ diagnostics });
      const response = await request(endpoint, '/v1/logs', options);

      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
      expect(exports).toEqual([]);
      expect(diagnostics.at(-1)).toMatchObject({ result: 'rejected', reason });
      expect(JSON.stringify(diagnostics)).not.toMatch(/private body|test-session-token/iu);
    },
  );

  it('rejects oversized bodies without exposing their contents', async () => {
    const diagnostics: DesktopReceiverDiagnostic[] = [];
    const { endpoint, exports } = await start({ maxBodyBytes: 8, diagnostics });
    const response = await request(endpoint, '/v1/metrics', {
      token: 'test-session-token-with-enough-entropy',
      contentType: 'application/x-protobuf',
      body: new Uint8Array(32).fill(115),
    });

    expect(response.status).toBe(413);
    expect(await response.text()).toBe('');
    expect(exports).toEqual([]);
    expect(diagnostics.at(-1)).toMatchObject({ result: 'rejected', reason: 'body-too-large' });
    expect(JSON.stringify(diagnostics)).not.toContain('ssssssss');
  });

  it('binds only an IPv4 loopback address on an ephemeral port', async () => {
    const { receiver, endpoint } = await start({});
    expect(new URL(endpoint).hostname).toBe('127.0.0.1');
    expect(Number(new URL(endpoint).port)).toBeGreaterThan(0);
    expect(receiver.snapshot().host).toBe('127.0.0.1');
  });
});
