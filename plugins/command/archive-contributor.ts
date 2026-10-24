import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { PostMergeRepositorySource } from '../../domains/post-merge/checkout.js';

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'run.archive.verify-merged',
        execute: ({ input, signal }) =>
          context.postMergeActions.verifyChangeRunMergedCode(
            input as {
              runId: string;
              profileId: string;
              sources: PostMergeRepositorySource[];
            },
            signal,
          ),
      }),
      context.commandRouter.register({
        name: 'run.archive.complete',
        execute: ({ input, signal }) =>
          context.postMergeActions.completeChangeRunArchive(
            (input as { runId: string }).runId,
            signal,
          ),
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, {
  inject: ['commandRouter', 'postMergeActions'],
});

export default plugin;
