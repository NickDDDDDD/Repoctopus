import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import type { HttpResponse, HttpRoute } from '../../services/http-host.js';

class HttpRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

export interface NodeHttpServerConfig {
  hostname?: string;
  port: number;
}

export interface NodeHttpServerCloseResult {
  drained: boolean;
  remaining: number;
  recoverability?: 'client_retry';
}

/** Node-specific listener and bounded raw-body reader behind the HttpHost Service. */
export class NodeHttpServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly started: Promise<void>;
  private readonly drainWaiters = new Set<() => void>();
  private accepting = true;
  private activeRequests = 0;
  private activeClientRetryRequests = 0;

  constructor(
    config: NodeHttpServerConfig,
    private readonly resolveRoute: (path: string) => HttpRoute | undefined,
  ) {
    this.server = createServer((request, response) => void this.dispatch(request, response));
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    this.started = new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(config.port, config.hostname ?? '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  async ready(): Promise<void> {
    await this.started;
  }

  origin(): string {
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP Host is not listening');
    return `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`;
  }

  private async body(request: IncomingMessage, limit: number): Promise<Uint8Array> {
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > limit) {
      request.resume();
      throw new HttpRequestError(413, 'request body is too large');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      size += chunk.byteLength;
      if (size > limit) throw new HttpRequestError(413, 'request body is too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.accepting) {
      request.resume();
      this.respond(response, {
        status: 503,
        headers: { 'retry-after': '1' },
        body: { error: 'HTTP Host is shutting down' },
      });
      return;
    }
    this.activeRequests += 1;
    let route: HttpRoute | undefined;
    try {
      const pathname = new URL(request.url ?? '/', 'http://repoctopus.local').pathname;
      route = this.resolveRoute(pathname);
      if (!route) {
        request.resume();
        this.respond(response, { status: 404, body: { error: 'route not found' } });
        return;
      }
      if (route.drainTimeoutRecoverability === 'client_retry') {
        this.activeClientRetryRequests += 1;
      }
      const result = await route.handle({
        method: request.method ?? '',
        path: pathname,
        headersDistinct: Object.fromEntries(
          Object.entries(request.headersDistinct).map(([name, values]) => [name.toLowerCase(), values]),
        ),
        body: await this.body(request, route.maxBodyBytes),
      });
      this.respond(response, result);
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof HttpRequestError) {
        this.respond(response, { status: error.status, body: { error: error.message } });
        return;
      }
      this.respond(response, { status: 500, body: { error: 'request handling failed' } });
    } finally {
      if (route?.drainTimeoutRecoverability === 'client_retry') {
        this.activeClientRetryRequests -= 1;
      }
      this.activeRequests -= 1;
      if (this.activeRequests === 0) {
        for (const resolve of this.drainWaiters) resolve();
        this.drainWaiters.clear();
      }
    }
  }

  private respond(response: ServerResponse, result: HttpResponse): void {
    if (response.destroyed) return;
    const body = result.body === undefined ? '' : JSON.stringify(result.body);
    response.writeHead(result.status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      ...result.headers,
    });
    response.end(body);
  }

  async close(timeoutMs: number): Promise<NodeHttpServerCloseResult> {
    if (!this.server.listening) return { drained: true, remaining: 0 };
    this.accepting = false;
    const listenerClosed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      this.server.closeIdleConnections();
    });
    const requestsDrained =
      this.activeRequests === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => this.drainWaiters.add(resolve));
    let drained = false;
    const completed = Promise.all([listenerClosed, requestsDrained]).then(() => {
      drained = true;
    });
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      completed,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (drained) return { drained: true, remaining: 0 };
    const remaining = Math.max(1, this.activeRequests, this.sockets.size);
    const recoverability =
      this.activeRequests > 0 && this.activeRequests === this.activeClientRetryRequests
        ? 'client_retry'
        : undefined;
    for (const socket of this.sockets) socket.destroy();
    await listenerClosed;
    return { drained: false, remaining, ...(recoverability ? { recoverability } : {}) };
  }
}
