import type { Context, Plugin } from '@deepseek-ai/cordis';

import { outcomeReceiptAdapter } from '../../services/work-dispatcher.js';

const plugin = ((context: Context) => {
  context.effect(() =>
    context.workDispatcher.register({ id: 'manual', requiredCapabilities: [] }),
  );
  for (const contributor of [
    { id: 'process', requiredCapabilities: ['process.execute'] },
    { id: 'git', requiredCapabilities: ['git.publish'] },
    { id: 'specification', requiredCapabilities: ['specification.write'] },
  ] as const) {
    context.effect(() => context.actionDispatcher.register(outcomeReceiptAdapter(contributor.id)));
    context.effect(() => context.workDispatcher.register(contributor));
  }
}) as Plugin;

Object.assign(plugin, { inject: ['actionDispatcher', 'workDispatcher'] });

export default plugin;
