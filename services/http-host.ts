import { Service, type Context } from '@deepseek-ai/cordis';

export interface HttpRequest {
  method: string;
  path: string;
  headersDistinct: Readonly<Record<string, readonly string[] | undefined>>;
  body: Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
}

export interface HttpRoute {
  readonly path: string;
  readonly maxBodyBytes: number;
  /** Declare only when a client can safely retry an interrupted in-flight request. */
  readonly drainTimeoutRecoverability?: 'client_retry';
  handle(request: HttpRequest): Promise<HttpResponse>;
}

/** Product-level route registry; Providers own concrete listener mechanisms. */
export abstract class HttpHost extends Service {
  private readonly routes = new Map<string, HttpRoute>();

  constructor(context: Context) {
    super(context, 'httpHost');
  }

  register(route: HttpRoute): () => void {
    if (!route.path.startsWith('/')) throw new Error('HTTP route path must start with /');
    if (!Number.isSafeInteger(route.maxBodyBytes) || route.maxBodyBytes < 0) {
      throw new Error('HTTP route body limit must be a non-negative safe integer');
    }
    if (this.routes.has(route.path))
      throw new Error(`HTTP route already registered: ${route.path}`);
    this.routes.set(route.path, route);
    return () => {
      if (this.routes.get(route.path) === route) this.routes.delete(route.path);
    };
  }

  protected resolve(path: string): HttpRoute | undefined {
    return this.routes.get(path);
  }

  abstract ready(): Promise<void>;
  abstract origin(): string;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    httpHost: HttpHost;
  }
}
