import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = ((context: Context) => {
  context.effect(() =>
    context.commandRouter.register({
      name: 'change.reconcile',
      execute: ({ input, signal }) =>
        context.consistencyReconciler.reconcile(input as { changeId?: string }, signal),
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'consistencyReconciler'] });

export default plugin;
