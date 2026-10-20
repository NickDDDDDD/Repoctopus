import type { Context, Plugin } from '@deepseek-ai/cordis';

import { githubPullRequestReference } from '../../platform/github/pull-request-event.js';
import type { PostMergeCoordinator } from '../../services/post-merge-coordinator.js';
import type { PlatformEventProcessor } from '../../services/platform-events.js';

export function createGitHubPostMergeProcessor(
  coordinator: Pick<PostMergeCoordinator, 'wake'>,
): PlatformEventProcessor {
  return {
    id: 'github-post-merge-coordinator',
    provider: 'github',
    eventType: 'pull_request',
    async process({ envelope, signal }) {
      let reference;
      try {
        reference = githubPullRequestReference(envelope);
      } catch {
        return { result: 'dead_letter', diagnostic: 'github-pull-request-payload-invalid' };
      }
      try {
        const outcome = await coordinator.wake(reference, signal);
        if (outcome.status === 'ambiguous') {
          return { result: 'dead_letter', diagnostic: outcome.diagnostic };
        }
        return { result: 'completed', diagnostic: outcome.diagnostic };
      } catch {
        return { result: 'retry', diagnostic: 'post-merge-refresh-failed' };
      }
    },
  };
}

const plugin = ((context: Context) => {
  context.effect(() =>
    context.platformEvents.register(createGitHubPostMergeProcessor(context.postMergeCoordinator)),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['platformEvents', 'postMergeCoordinator'] });

export default plugin;
