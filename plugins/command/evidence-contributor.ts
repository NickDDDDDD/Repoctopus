import type { Context, Plugin } from '@deepseek-ai/cordis';

interface RunInput {
  profileId: string;
  attemptId?: string;
  workflowRunId?: string | null;
}

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'evidence.plan',
        execute: ({ input }) =>
          context.evidenceCoordinator.plan((input as { profileId: string }).profileId),
      }),
      context.commandRouter.register({
        name: 'evidence.run',
        execute: ({ input, signal }) => {
          const request = input as RunInput;
          return context.evidenceCoordinator.run(
            request.profileId,
            request.attemptId,
            request.workflowRunId ?? null,
            signal,
          );
        },
      }),
      context.commandRouter.register({
        name: 'evidence.status',
        execute: ({ input }) =>
          context.evidenceCoordinator.status((input as { attemptId: string }).attemptId),
      }),
      context.commandRouter.register({
        name: 'evidence.resume',
        execute: ({ input, signal }) =>
          context.evidenceCoordinator.resume((input as { attemptId: string }).attemptId, signal),
      }),
      context.commandRouter.register({
        name: 'evidence.inspect',
        execute: ({ input }) =>
          context.evidenceCoordinator.inspect((input as { attemptId: string }).attemptId),
      }),
      context.commandRouter.register({
        name: 'evidence.clean',
        execute: ({ input }) =>
          context.evidenceCoordinator.clean(input as { maxAgeMs: number; maxBytes: number }),
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, {
  inject: ['commandRouter', 'evidenceCoordinator'],
});

export default plugin;
