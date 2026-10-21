import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'event.status',
        execute: ({ input }) =>
          context.platformEvents.status((input as { envelopeId: string }).envelopeId),
      }),
      context.commandRouter.register({
        name: 'event.replay',
        execute: ({ input }) => {
          const request = input as { envelope: unknown; timestamp?: string };
          return context.platformEvents.replay(request.envelope, request.timestamp);
        },
      }),
      context.commandRouter.register({
        name: 'event.retry',
        execute: ({ input }) => {
          const request = input as { envelopeId: string; timestamp?: string };
          return context.platformEvents.retry(request.envelopeId, request.timestamp);
        },
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'platformEvents'] });

export default plugin;
