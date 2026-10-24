import type { Context, Plugin } from '@deepseek-ai/cordis';

import type {
  DeliveryPolicy,
} from '../../domains/delivery/types.js';

const plugin = ((context: Context) => {
  const migrationRequired = (replacementCommand: string) => ({
    schemaVersion: 1 as const,
    status: 'migration_required' as const,
    diagnostic: 'change-lifecycle-run-required' as const,
    replacementCommand,
  });
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'delivery.checkpoint',
        execute: () => Promise.resolve(migrationRequired('run.archive.prepare')),
      }),
      context.commandRouter.register({
        name: 'delivery.prepare',
        execute: () => Promise.resolve(migrationRequired('run.archive.prepare')),
      }),
      context.commandRouter.register({
        name: 'delivery.status',
        execute: ({ input, signal }) =>
          context.delivery.status((input as { changeId: string }).changeId, signal),
      }),
      context.commandRouter.register({
        name: 'delivery.decide',
        execute: () => Promise.resolve(migrationRequired('run.change.decide')),
      }),
      context.commandRouter.register({
        name: 'delivery.publish',
        execute: () => Promise.resolve(migrationRequired('run.archive.publish')),
      }),
      context.commandRouter.register({
        name: 'delivery.refresh',
        execute: () => Promise.resolve(migrationRequired('run.archive.refresh')),
      }),
      context.commandRouter.register({
        name: 'delivery.migration-plan',
        execute: ({ input, signal }) => {
          const request = input as { changeId: string; policy: DeliveryPolicy };
          return context.delivery.migrationPlan(request.changeId, request.policy, signal);
        },
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'delivery'] });

export default plugin;
