import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { ProjectProbeInput } from '../../services/project.js';

const plugin = ((context: Context) => {
  context.effect(() =>
    context.commandRouter.register({
      name: 'project.probe',
      execute: ({ input, signal }) => {
        if (signal.aborted) throw signal.reason;
        return context.project.probe(input as ProjectProbeInput);
      },
    }),
  );
}) as Plugin;

Object.assign(plugin, {
  inject: ['commandRouter', 'project'],
});

export default plugin;
