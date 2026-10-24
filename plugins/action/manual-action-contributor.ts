import type { Context, Plugin } from '@deepseek-ai/cordis';

import { outcomeReceiptAdapter } from '../../services/work-dispatcher.js';

const plugin = ((context: Context) => {
  context.effect(() => context.actionDispatcher.register(outcomeReceiptAdapter('manual')));
}) as Plugin;

Object.assign(plugin, {
  inject: ['actionDispatcher'],
});

export default plugin;
