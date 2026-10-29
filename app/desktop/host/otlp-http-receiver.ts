import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { serializeDesktopReceiverHealth } from '../shared/receiver-health.js';

export type OtlpSignal = 'trace' | 'log' | 'metric';

export interface DesktopOtlpExport {
  signal: OtlpSignal;
  contentType: 'json' | 'protobuf';
  body: Uint8Array;
}

export interface DesktopOtlpHttpReceiverOptions {
  sessionToken: string;
  onExport(request: DesktopOtlpExport): void | Promise<void>;
  maxBodyBytes?: number;
  maxConcurrent?: number;
}

const SIGNAL_BY_PATH: Readonly<Record<string, OtlpSignal>> = {
  '/v1/traces': 'trace',
  '/v1/logs': 'log',
  '/v1/metrics': 'metric',
};

function response(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(JSON.stringify({ code }));
}

function authorized(header: string | undefined, expected: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const target = Buffer.from(expected, 'utf8');
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

function health(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(serializeDesktopReceiverHealth(process.pid));
}

function requestContentType(request: IncomingMessage): 'json' | 'protobuf' | null {
  const value = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (value === 'application/json') return 'json';
  if (value === 'application/x-protobuf') return 'protobuf';
  return null;
}

async function body(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maximum) throw new Error('request-too-large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array);
    size += value.length;
    if (size > maximum) throw new Error('request-too-large');
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Authenticated standard OTLP/HTTP endpoint owned by the Desktop Host. */
export class DesktopOtlpHttpReceiver {
  private server: Server | null = null;
  private endpoint: string | null = null;
  private active = 0;

  constructor(private readonly options: DesktopOtlpHttpReceiverOptions) {
    if (options.sessionToken.length < 24) {
      throw new Error('Desktop OTLP session token must contain at least 24 characters');
    }
  }

  async start(): Promise<string> {
    if (this.server !== null) return this.endpoint!;
    const server = createServer((request, outgoing) => {
      void this.accept(request, outgoing);
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 5_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string' || address.address !== '127.0.0.1') {
      server.close();
      throw new Error('Desktop OTLP receiver did not bind the IPv4 loopback interface');
    }
    this.server = server;
    this.endpoint = `http://127.0.0.1:${address.port}`;
    return this.endpoint;
  }

  snapshot(): { endpoint: string | null; activeRequests: number } {
    return { endpoint: this.endpoint, activeRequests: this.active };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.endpoint = null;
    if (server === null) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
  }

  private async accept(request: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    if (request.url === '/health') {
      if (request.method !== 'GET') return response(outgoing, 405, 'method-not-allowed');
      if (!authorized(request.headers.authorization, this.options.sessionToken)) {
        return response(outgoing, 401, 'unauthorized');
      }
      request.resume();
      return health(outgoing);
    }
    const signal = SIGNAL_BY_PATH[request.url ?? ''];
    if (signal === undefined) return response(outgoing, 404, 'not-found');
    if (request.method !== 'POST') return response(outgoing, 405, 'method-not-allowed');
    if (!authorized(request.headers.authorization, this.options.sessionToken)) {
      return response(outgoing, 401, 'unauthorized');
    }
    if (request.headers['content-encoding'] !== undefined) {
      return response(outgoing, 415, 'content-encoding-not-supported');
    }
    const contentType = requestContentType(request);
    if (contentType === null) return response(outgoing, 415, 'content-type-not-supported');
    if (this.active >= (this.options.maxConcurrent ?? 8)) {
      return response(outgoing, 429, 'receiver-busy');
    }
    this.active += 1;
    try {
      const payload = await body(request, this.options.maxBodyBytes ?? 1024 * 1024);
      if (payload.length === 0) return response(outgoing, 400, 'empty-request');
      if (contentType === 'json') {
        try {
          JSON.parse(payload.toString('utf8'));
        } catch {
          return response(outgoing, 400, 'malformed-otlp');
        }
      }
      await this.options.onExport({ signal, contentType, body: payload });
      response(outgoing, 200, 'accepted');
    } catch (error) {
      response(
        outgoing,
        error instanceof Error && error.message === 'request-too-large' ? 413 : 400,
        error instanceof Error && error.message === 'request-too-large'
          ? 'request-too-large'
          : 'request-rejected',
      );
    } finally {
      this.active -= 1;
    }
  }
}
