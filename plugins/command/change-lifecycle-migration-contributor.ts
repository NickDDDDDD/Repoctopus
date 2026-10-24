import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { LegacyLifecycleRecord } from '../../domains/change-lifecycle/migration.js';
import type { ApplyChangeLifecycleMigrationInput } from '../../services/change-lifecycle-migration.js';

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'run.migration.plan',
        execute: ({ input }) =>
          Promise.resolve(context.changeLifecycleMigration.plan(input as LegacyLifecycleRecord)),
      }),
      context.commandRouter.register({
        name: 'run.migration.apply',
        execute: ({ input, signal }) =>
          context.changeLifecycleMigration.apply(
            input as ApplyChangeLifecycleMigrationInput,
            signal,
          ),
      }),
    ];
    return () => disposers.reverse().forEach((dispose) => dispose());
  });
}) as Plugin;

Object.assign(plugin, { inject: ['changeLifecycleMigration', 'commandRouter'] });

export default plugin;
