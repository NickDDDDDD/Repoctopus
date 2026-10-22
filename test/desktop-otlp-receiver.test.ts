import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createDesktopOtlpSessionToken,
  DesktopOtlpReceiver,
  type DesktopOtlpBatch,
  type DesktopOtlpDiagnostic,
  type DesktopOtlpSignal,
} from '../platform/telemetry/desktop-otlp-receiver.js';

const receivers: DesktopOtlpReceiver[] = [];

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((receiver) => receiver.close()));
});

function send(input: {
  receiver: DesktopOtlpReceiver;
  signal: DesktopOtlpSignal;
  method?: string;
  headers?: OutgoingHttpHeaders;
  body?: string | Uint8Array;
}): Promise<{ status: number; headers: OutgoingHttpHeaders; body: unknown }> {
  const url = new URL(`/v1/${input.signal}`, input.receiver.origin());
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: input.method ?? 'POST', headers: input.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text ? (JSON.parse(text) as unknown) : null,
          });
        });
      },
    );
    request.on('error', reject);
    request.end(input.body);
  });
}

async function fixture(
  options: {
    maxBodyBytes?: number;
    accept?: (batch: DesktopOtlpBatch) => void | Promise<void>;
  } = {},
) {
  const token = createDesktopOtlpSessionToken();
  const accepted: DesktopOtlpBatch[] = [];
  const diagnostics: DesktopOtlpDiagnostic[] = [];
  const receiver = new DesktopOtlpReceiver({
    sessionToken: token,
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    accept:
      options.accept ??
      ((batch) => {
        accepted.push(structuredClone(batch));
      }),
    diagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  receivers.push(receiver);
  await receiver.ready();
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  return { receiver, headers, accepted, diagnostics };
}

describe('Desktop OTLP/HTTP receiver', () => {
  it('binds loopback and accepts standard JSON Trace, Log and Metric requests', async () => {
    const target = await fixture();
    expect(new URL(target.receiver.origin()).hostname).toBe('127.0.0.1');

    for (const [signal, key] of [
      ['traces', 'resourceSpans'],
      ['logs', 'resourceLogs'],
      ['metrics', 'resourceMetrics'],
    ] as const) {
      await expect(
        send({
          receiver: target.receiver,
          signal,
          headers: target.headers,
          body: JSON.stringify({ [key]: [] }),
        }),
      ).resolves.toMatchObject({ status: 200, body: {} });
    }
    expect(target.accepted.map((batch) => batch.signal)).toEqual(['traces', 'logs', 'metrics']);
    expect(target.diagnostics).toEqual([]);
  });

  it('rejects missing and incorrect session authorization', async () => {
    const target = await fixture();
    const body = JSON.stringify({ resourceSpans: [] });
    const cases: OutgoingHttpHeaders[] = [
      { 'content-type': 'application/json' },
      {
        'content-type': 'application/json',
        authorization: `Bearer ${createDesktopOtlpSessionToken()}`,
      },
    ];
    for (const headers of cases) {
      await expect(
        send({ receiver: target.receiver, signal: 'traces', headers, body }),
      ).resolves.toMatchObject({
        status: 401,
        body: { error: 'unauthorized' },
      });
    }
    expect(target.accepted).toEqual([]);
  });

  it('rejects wrong methods and content types with bounded protocol diagnostics', async () => {
    const target = await fixture();
    await expect(
      send({
        receiver: target.receiver,
        signal: 'logs',
        method: 'GET',
        headers: target.headers,
      }),
    ).resolves.toMatchObject({ status: 405, body: { error: 'method-not-allowed' } });
    await expect(
      send({
        receiver: target.receiver,
        signal: 'metrics',
        headers: { ...target.headers, 'content-type': 'application/x-protobuf' },
        body: '{}',
      }),
    ).resolves.toMatchObject({
      status: 415,
      body: { error: 'unsupported-content-type' },
    });
    expect(target.diagnostics).toEqual([
      { code: 'method-not-allowed', signal: 'logs' },
      { code: 'unsupported-content-type', signal: 'metrics' },
    ]);
  });

  it('rejects oversized, malformed and structurally wrong payloads without echoing bodies', async () => {
    const target = await fixture({ maxBodyBytes: 32 });
    const privateBody = '{"resourceLogs":[{"body":"TOP-SECRET-CONTENT"}]}';
    const oversized = await send({
      receiver: target.receiver,
      signal: 'logs',
      headers: target.headers,
      body: privateBody,
    });
    expect(oversized).toMatchObject({
      status: 413,
      body: { error: 'request body is too large' },
    });
    expect(JSON.stringify(oversized)).not.toContain('TOP-SECRET-CONTENT');

    const malformed = await send({
      receiver: target.receiver,
      signal: 'traces',
      headers: target.headers,
      body: '{"private":"DO-NOT-ECHO"',
    });
    expect(malformed).toMatchObject({ status: 400, body: { error: 'invalid-json' } });
    expect(JSON.stringify(malformed)).not.toContain('DO-NOT-ECHO');

    await expect(
      send({
        receiver: target.receiver,
        signal: 'metrics',
        headers: target.headers,
        body: '{"resourceMetrics":{}}',
      }),
    ).resolves.toMatchObject({ status: 400, body: { error: 'invalid-otlp-payload' } });
    expect(target.accepted).toEqual([]);
  });

  it('returns a retryable bounded error when the downstream projection is unavailable', async () => {
    const target = await fixture({
      accept: () => Promise.reject(new Error('private projection failure details')),
    });
    const result = await send({
      receiver: target.receiver,
      signal: 'traces',
      headers: target.headers,
      body: '{"resourceSpans":[]}',
    });
    expect(result).toMatchObject({ status: 503, body: { error: 'receiver-unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private projection failure');
    expect(target.diagnostics).toEqual([{ code: 'receiver-unavailable', signal: 'traces' }]);
  });
});
