import { EventInboxConflictError } from '../../domains/platform-events/inbox.js';
import type { PlatformWebhookAdapter } from '../../domains/platform-events/ports.js';
import type { HttpRequest, HttpResponse, HttpRoute } from '../../services/http-host.js';
import type { PlatformEvents } from '../../services/platform-events.js';
import { WebhookRequestError } from './github-webhook.js';

export interface GitHubWebhookRouteOptions {
  adapter: PlatformWebhookAdapter;
  events: PlatformEvents;
  maxBodyBytes: number;
  path?: string;
  now?: () => Date;
}

export class GitHubWebhookRoute implements HttpRoute {
  readonly path: string;
  readonly maxBodyBytes: number;
  readonly drainTimeoutRecoverability = 'client_retry' as const;
  private readonly now: () => Date;

  constructor(private readonly options: GitHubWebhookRouteOptions) {
    this.path = options.path ?? '/webhooks/github';
    this.maxBodyBytes = options.maxBodyBytes;
    this.now = options.now ?? (() => new Date());
  }

  async handle(request: HttpRequest): Promise<HttpResponse> {
    const receivedAt = this.now().toISOString();
    try {
      const contentTypes = request.headersDistinct['content-type'];
      const envelope = await this.options.adapter.verify(
        {
          method: request.method,
          ...(contentTypes?.length === 1 ? { contentType: contentTypes[0] } : {}),
          headersDistinct: request.headersDistinct,
          body: request.body,
        },
        receivedAt,
      );
      const accepted = await this.options.events.accept(envelope, receivedAt);
      return {
        status: 202,
        body: { accepted: true, ...accepted },
      };
    } catch (error) {
      if (error instanceof WebhookRequestError) {
        return { status: error.status, body: { error: error.message } };
      }
      if (error instanceof EventInboxConflictError) {
        return {
          status: 409,
          body: { error: 'Delivery ID conflicts with the persisted payload' },
        };
      }
      return { status: 503, body: { error: 'Event Inbox is unavailable' } };
    }
  }
}
