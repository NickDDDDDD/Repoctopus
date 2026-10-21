import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = ((context: Context) => {
  context.effect(() =>
    context.commandRouter.register({
      name: 'post-merge.reconcile',
      execute: ({ signal }) => context.postMergeCoordinator.reconcile(signal),
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'postMergeCoordinator'] });

export default plugin;
