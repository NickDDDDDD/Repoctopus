import { describe, expect, it } from 'vitest';

import { DesktopOtlpHttpReceiver } from '../app/desktop/host/otlp-http-receiver.js';

describe('Desktop OTLP/HTTP receiver', () => {
  it('accepts authenticated trace, log and metric JSON only on loopback', async () => {
    const received: string[] = [];
    const receiver = new DesktopOtlpHttpReceiver({
      sessionToken: 'a'.repeat(32),
      onExport: (request) => {
        received.push(request.signal);
      },
    });
    const endpoint = await receiver.start();
    try {
      expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      for (const signal of ['traces', 'logs', 'metrics']) {
        const response = await fetch(`${endpoint}/v1/${signal}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${'a'.repeat(32)}`,
            'content-type': 'application/json',
          },
          body: '{}',
        });
        expect(response.status).toBe(200);
      }
      expect(received).toEqual(['trace', 'log', 'metric']);
    } finally {
      await receiver.stop();
    }
  });

  it('rejects unsafe requests without echoing their bodies', async () => {
    const receiver = new DesktopOtlpHttpReceiver({
      sessionToken: 'b'.repeat(32),
      maxBodyBytes: 16,
      onExport: () => {
        throw new Error('must not ingest rejected requests');
      },
    });
    const endpoint = await receiver.start();
    try {
      const cases = [
        fetch(`${endpoint}/v1/logs`, { method: 'POST', body: 'SECRET' }),
        fetch(`${endpoint}/v1/logs`, {
          method: 'GET',
          headers: { authorization: `Bearer ${'b'.repeat(32)}` },
        }),
        fetch(`${endpoint}/v1/logs`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${'b'.repeat(32)}`,
            'content-type': 'text/plain',
          },
          body: 'SECRET',
        }),
        fetch(`${endpoint}/v1/logs`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${'b'.repeat(32)}`,
            'content-type': 'application/json',
          },
          body: 'SECRET-TOO-LARGE-PAYLOAD',
        }),
        fetch(`${endpoint}/v1/logs`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${'b'.repeat(32)}`,
            'content-type': 'application/json',
          },
          body: '{',
        }),
      ];
      for (const pending of cases) {
        const response = await pending;
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(await response.text()).not.toContain('SECRET');
      }
    } finally {
      await receiver.stop();
    }
  });
});
