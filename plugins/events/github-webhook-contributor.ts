import type { Context, Plugin } from '@deepseek-ai/cordis';

import {
  EnvironmentWebhookCredentialProvider,
  GitHubWebhookAdapter,
} from '../../platform/events/github-webhook.js';
import { GitHubWebhookRoute } from '../../platform/events/github-webhook-route.js';

export interface GitHubWebhookContributorConfig {
  environment?: Readonly<Record<string, string | undefined>>;
  credentialVariable?: string;
  source?: string;
  path?: string;
  maxBodyBytes?: number;
  now?: () => Date;
}

const plugin = ((context: Context, config: GitHubWebhookContributorConfig) => {
  const maxBodyBytes = config.maxBodyBytes ?? 1024 * 1024;
  const route = new GitHubWebhookRoute({
    adapter: new GitHubWebhookAdapter(
      new EnvironmentWebhookCredentialProvider(
        config.environment ?? process.env,
        config.credentialVariable,
      ),
      { source: config.source ?? 'primary', maxBodyBytes },
    ),
    events: context.platformEvents,
    maxBodyBytes,
    ...(config.path === undefined ? {} : { path: config.path }),
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  context.effect(() => context.httpHost.register(route), 'repoctopus.github-webhook-route');
}) as Plugin;

Object.assign(plugin, { inject: ['httpHost', 'platformEvents'] });

export default plugin;
