import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { HttpRequest, HttpResponse, HttpRoute } from '../../services/http-host.js';
import { NodeHttpServer, type NodeHttpServerCloseResult } from '../http/node-http-server.js';

export type DesktopOtlpSignal = 'traces' | 'logs' | 'metrics';

export interface DesktopOtlpBatch {
  signal: DesktopOtlpSignal;
  payload: Readonly<Record<string, unknown>>;
}

export interface DesktopOtlpDiagnostic {
  code:
    | 'unauthorized'
    | 'method-not-allowed'
    | 'unsupported-content-type'
    | 'invalid-json'
    | 'invalid-otlp-payload'
    | 'receiver-busy'
    | 'receiver-unavailable';
  signal: DesktopOtlpSignal;
}

export interface DesktopOtlpReceiverOptions {
  sessionToken: string;
  accept(batch: DesktopOtlpBatch): void | Promise<void>;
  diagnostic?: (diagnostic: DesktopOtlpDiagnostic) => void;
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
}

const ROUTES: Readonly<Record<string, DesktopOtlpSignal>> = {
  '/v1/traces': 'traces',
  '/v1/logs': 'logs',
  '/v1/metrics': 'metrics',
};

const PAYLOAD_KEYS: Readonly<Record<DesktopOtlpSignal, string>> = {
  traces: 'resourceSpans',
  logs: 'resourceLogs',
  metrics: 'resourceMetrics',
};

const SESSION_TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;

function singleHeader(request: HttpRequest, name: string): string | undefined {
  const values = request.headersDistinct[name];
  return values?.length === 1 ? values[0] : undefined;
}

function authorized(request: HttpRequest, expectedToken: string): boolean {
  const value = singleHeader(request, 'authorization');
  if (!value?.startsWith('Bearer ')) return false;
  const actualToken = value.slice('Bearer '.length);
  const actual = Buffer.from(actualToken);
  const expected = Buffer.from(expectedToken);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function contentType(request: HttpRequest): string | undefined {
  return singleHeader(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
}

function decodeJson(body: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
}

function isOtlpPayload(
  value: unknown,
  signal: DesktopOtlpSignal,
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const entries = payload[PAYLOAD_KEYS[signal]];
  return entries === undefined || Array.isArray(entries);
}

function response(status: number, error?: string): HttpResponse {
  return error === undefined ? { status, body: {} } : { status, body: { error } };
}

export function createDesktopOtlpSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Headless, loopback-only OTLP/HTTP JSON receiver owned by the Desktop Host. */
export class DesktopOtlpReceiver {
  private readonly server: NodeHttpServer;
  private readonly routes: ReadonlyMap<string, HttpRoute>;
  private activeRequests = 0;

  constructor(private readonly options: DesktopOtlpReceiverOptions) {
    if (!SESSION_TOKEN.test(options.sessionToken)) {
      throw new Error(
        'Desktop OTLP session token must contain at least 256 bits of base64url data',
      );
    }
    const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
    const maxConcurrentRequests = options.maxConcurrentRequests ?? 8;
    if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
      throw new Error('Desktop OTLP body limit must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
      throw new Error('Desktop OTLP concurrency limit must be a positive safe integer');
    }

    this.routes = new Map(
      Object.entries(ROUTES).map(([routePath, signal]) => [
        routePath,
        {
          path: routePath,
          maxBodyBytes,
          drainTimeoutRecoverability: 'client_retry',
          handle: (request: HttpRequest) => this.handle(request, signal, maxConcurrentRequests),
        },
      ]),
    );
    this.server = new NodeHttpServer({ hostname: '127.0.0.1', port: 0 }, (routePath) =>
      this.routes.get(routePath),
    );
  }

  ready(): Promise<void> {
    return this.server.ready();
  }

  origin(): string {
    return this.server.origin();
  }

  close(timeoutMs = 5_000): Promise<NodeHttpServerCloseResult> {
    return this.server.close(timeoutMs);
  }

  private diagnose(code: DesktopOtlpDiagnostic['code'], signal: DesktopOtlpSignal): void {
    this.options.diagnostic?.({ code, signal });
  }

  private async handle(
    request: HttpRequest,
    signal: DesktopOtlpSignal,
    maxConcurrentRequests: number,
  ): Promise<HttpResponse> {
    if (request.method !== 'POST') {
      this.diagnose('method-not-allowed', signal);
      return {
        ...response(405, 'method-not-allowed'),
        headers: { allow: 'POST' },
      };
    }
    if (!authorized(request, this.options.sessionToken)) {
      this.diagnose('unauthorized', signal);
      return {
        ...response(401, 'unauthorized'),
        headers: { 'www-authenticate': 'Bearer' },
      };
    }
    if (contentType(request) !== 'application/json') {
      this.diagnose('unsupported-content-type', signal);
      return response(415, 'unsupported-content-type');
    }
    if (this.activeRequests >= maxConcurrentRequests) {
      this.diagnose('receiver-busy', signal);
      return {
        ...response(429, 'receiver-busy'),
        headers: { 'retry-after': '1' },
      };
    }

    this.activeRequests += 1;
    try {
      let payload: unknown;
      try {
        payload = decodeJson(request.body);
      } catch {
        this.diagnose('invalid-json', signal);
        return response(400, 'invalid-json');
      }
      if (!isOtlpPayload(payload, signal)) {
        this.diagnose('invalid-otlp-payload', signal);
        return response(400, 'invalid-otlp-payload');
      }
      try {
        await this.options.accept({ signal, payload });
      } catch {
        this.diagnose('receiver-unavailable', signal);
        return response(503, 'receiver-unavailable');
      }
      return response(200);
    } finally {
      this.activeRequests -= 1;
    }
  }
}
