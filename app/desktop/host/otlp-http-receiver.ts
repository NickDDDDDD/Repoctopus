import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type DesktopOtlpSignal = 'trace' | 'log' | 'metric';
export type DesktopOtlpContentType = 'protobuf' | 'json';

export type DesktopReceiverRejectionReason =
  | 'not-found'
  | 'unauthorized'
  | 'method-not-allowed'
  | 'unsupported-content-type'
  | 'unsupported-content-encoding'
  | 'body-too-large'
  | 'malformed-body'
  | 'too-many-requests'
  | 'internal-error';

export type DesktopReceiverDiagnostic = Readonly<{
  schemaVersion: 1;
  signal: DesktopOtlpSignal | null;
  result: 'accepted' | 'rejected';
  reason: 'accepted' | DesktopReceiverRejectionReason;
  observedAt: string;
  bodyBytes: number;
}>;

export type DesktopOtlpExport = Readonly<{
  schemaVersion: 1;
  signal: DesktopOtlpSignal;
  contentType: DesktopOtlpContentType;
  body: Uint8Array;
  receivedAt: string;
}>;

export type DesktopReceiverSnapshot = Readonly<{
  schemaVersion: 1;
  host: '127.0.0.1';
  endpoint: string | null;
  acceptedCount: number;
  rejectedCount: number;
  activeRequests: number;
}>;

export type DesktopOtlpHttpReceiverOptions = Readonly<{
  sessionToken: string;
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
  onExport: (record: DesktopOtlpExport) => void | Promise<void>;
  onDiagnostic?: (diagnostic: DesktopReceiverDiagnostic) => void;
}>;

const LOOPBACK_HOST = '127.0.0.1' as const;
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 16;
const SIGNAL_BY_PATH: Readonly<Record<string, DesktopOtlpSignal>> = {
  '/v1/traces': 'trace',
  '/v1/logs': 'log',
  '/v1/metrics': 'metric',
};
const JSON_ROOT_BY_SIGNAL: Readonly<Record<DesktopOtlpSignal, string>> = {
  trace: 'resourceSpans',
  log: 'resourceLogs',
  metric: 'resourceMetrics',
};

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseContentType(value: string | undefined): DesktopOtlpContentType | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === 'application/x-protobuf') return 'protobuf';
  if (mediaType === 'application/json') return 'json';
  return undefined;
}

function isValidJson(body: Buffer, signal: DesktopOtlpSignal): boolean {
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    return Array.isArray((value as Record<string, unknown>)[JSON_ROOT_BY_SIGNAL[signal]]);
  } catch {
    return false;
  }
}

function respond(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.setHeader('content-length', '0');
  response.end();
}

export class DesktopOtlpHttpReceiver {
  readonly #sessionDigest: Buffer;
  readonly #maxBodyBytes: number;
  readonly #maxConcurrentRequests: number;
  readonly #onExport: DesktopOtlpHttpReceiverOptions['onExport'];
  readonly #onDiagnostic: NonNullable<DesktopOtlpHttpReceiverOptions['onDiagnostic']>;
  #server: Server | undefined;
  #endpoint: string | null = null;
  #acceptedCount = 0;
  #rejectedCount = 0;
  #activeRequests = 0;

  constructor(options: DesktopOtlpHttpReceiverOptions) {
    if (options.sessionToken.length < 24) {
      throw new Error('sessionToken must contain at least 24 characters');
    }
    this.#sessionDigest = tokenDigest(options.sessionToken);
    this.#maxBodyBytes = positiveInteger(
      options.maxBodyBytes,
      DEFAULT_MAX_BODY_BYTES,
      'maxBodyBytes',
    );
    this.#maxConcurrentRequests = positiveInteger(
      options.maxConcurrentRequests,
      DEFAULT_MAX_CONCURRENT_REQUESTS,
      'maxConcurrentRequests',
    );
    this.#onExport = options.onExport;
    this.#onDiagnostic = options.onDiagnostic ?? (() => undefined);
  }

  async start(): Promise<string> {
    if (this.#endpoint !== null) return this.#endpoint;
    if (this.#server !== undefined) throw new Error('Desktop OTLP receiver is already starting');

    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    this.#server = server;
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
    });

    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        server.off('listening', ready);
        reject(error);
      };
      const ready = () => {
        server.off('error', fail);
        resolve();
      };
      server.once('error', fail);
      server.once('listening', ready);
      server.listen(0, LOOPBACK_HOST);
    });

    const address = server.address();
    if (address === null || typeof address === 'string') {
      await this.stop();
      throw new Error('Desktop OTLP receiver did not acquire a TCP address');
    }
    this.#endpoint = `http://${LOOPBACK_HOST}:${address.port}`;
    return this.#endpoint;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#endpoint = null;
    if (server === undefined || !server.listening) return;
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  snapshot(): DesktopReceiverSnapshot {
    return {
      schemaVersion: 1,
      host: LOOPBACK_HOST,
      endpoint: this.#endpoint,
      acceptedCount: this.#acceptedCount,
      rejectedCount: this.#rejectedCount,
      activeRequests: this.#activeRequests,
    };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const signal = request.url === undefined ? undefined : SIGNAL_BY_PATH[request.url];
    if (signal === undefined) {
      request.resume();
      this.#reject(response, null, 'not-found', 404, 0);
      return;
    }

    const suppliedToken = headerValue(request.headers['x-repoctopus-session']) ?? '';
    if (!timingSafeEqual(this.#sessionDigest, tokenDigest(suppliedToken))) {
      request.resume();
      this.#reject(response, signal, 'unauthorized', 401, 0);
      return;
    }
    if (request.method !== 'POST') {
      request.resume();
      response.setHeader('allow', 'POST');
      this.#reject(response, signal, 'method-not-allowed', 405, 0);
      return;
    }

    const contentType = parseContentType(headerValue(request.headers['content-type']));
    if (contentType === undefined) {
      request.resume();
      this.#reject(response, signal, 'unsupported-content-type', 415, 0);
      return;
    }
    const contentEncoding = headerValue(request.headers['content-encoding'])?.trim().toLowerCase();
    if (contentEncoding !== undefined && contentEncoding !== 'identity') {
      request.resume();
      this.#reject(response, signal, 'unsupported-content-encoding', 415, 0);
      return;
    }
    if (this.#activeRequests >= this.#maxConcurrentRequests) {
      request.resume();
      this.#reject(response, signal, 'too-many-requests', 429, 0);
      return;
    }

    const declaredLength = Number(headerValue(request.headers['content-length']));
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxBodyBytes) {
      request.resume();
      this.#reject(response, signal, 'body-too-large', 413, declaredLength);
      return;
    }

    this.#activeRequests += 1;
    try {
      const body = await this.#readBody(request);
      if (body === undefined) {
        this.#reject(response, signal, 'body-too-large', 413, this.#maxBodyBytes + 1);
        return;
      }
      if (body.byteLength === 0 || (contentType === 'json' && !isValidJson(body, signal))) {
        this.#reject(response, signal, 'malformed-body', 400, body.byteLength);
        return;
      }

      try {
        await this.#onExport({
          schemaVersion: 1,
          signal,
          contentType,
          body: new Uint8Array(body),
          receivedAt: new Date().toISOString(),
        });
      } catch {
        this.#reject(response, signal, 'internal-error', 500, body.byteLength);
        return;
      }

      this.#acceptedCount += 1;
      this.#diagnose(signal, 'accepted', 'accepted', body.byteLength);
      respond(response, 200);
    } catch {
      if (!response.headersSent) this.#reject(response, signal, 'internal-error', 500, 0);
    } finally {
      this.#activeRequests -= 1;
    }
  }

  async #readBody(request: IncomingMessage): Promise<Buffer | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.byteLength;
      if (size > this.#maxBodyBytes) {
        exceeded = true;
        continue;
      }
      chunks.push(buffer);
    }
    return exceeded ? undefined : Buffer.concat(chunks, size);
  }

  #reject(
    response: ServerResponse,
    signal: DesktopOtlpSignal | null,
    reason: DesktopReceiverRejectionReason,
    statusCode: number,
    bodyBytes: number,
  ): void {
    this.#rejectedCount += 1;
    this.#diagnose(signal, 'rejected', reason, bodyBytes);
    respond(response, statusCode);
  }

  #diagnose(
    signal: DesktopOtlpSignal | null,
    result: DesktopReceiverDiagnostic['result'],
    reason: DesktopReceiverDiagnostic['reason'],
    bodyBytes: number,
  ): void {
    try {
      this.#onDiagnostic({
        schemaVersion: 1,
        signal,
        result,
        reason,
        observedAt: new Date().toISOString(),
        bodyBytes,
      });
    } catch {
      // Diagnostics are observational and must never alter receiver behavior.
    }
  }
}
