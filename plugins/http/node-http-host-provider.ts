import type { Context } from '@deepseek-ai/cordis';

import { NodeHttpServer, type NodeHttpServerConfig } from '../../platform/http/node-http-server.js';
import { HttpHost } from '../../services/http-host.js';

export interface NodeHttpHostConfig extends NodeHttpServerConfig {
  shutdownTimeoutMs?: number;
}

export class NodeHttpHostProvider extends HttpHost {
  private readonly server: NodeHttpServer;

  constructor(context: Context, config: NodeHttpHostConfig) {
    super(context);
    this.server = new NodeHttpServer(config, (routePath) => this.resolve(routePath));
    const diagnostics = context.get('lifecycleDiagnostics');
    context.effect(async () => {
      await this.server.ready();
      return async () => {
        const result = await this.server.close(config.shutdownTimeoutMs ?? 5_000);
        if (result.drained) return;
        diagnostics?.record({
          code: 'OPERATION_DRAIN_TIMEOUT',
          service: 'httpHost',
          remaining: result.remaining,
          ...(result.recoverability ? { recoverability: result.recoverability } : {}),
          timestamp: new Date().toISOString(),
        });
        diagnostics?.event({
          type: 'operation.drain',
          phase: 'draining',
          result: 'timed_out',
          service: 'httpHost',
          remaining: result.remaining,
          ...(result.recoverability ? { recoverability: result.recoverability } : {}),
        });
        context.logger.warn(
          'HTTP Host drain timed out with %d connection(s) remaining',
          result.remaining,
        );
      };
    }, 'repoctopus.http-host');
  }

  ready(): Promise<void> {
    return this.server.ready();
  }

  origin(): string {
    return this.server.origin();
  }
}
