import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = ((context: Context) => {
  context.on('repoctopus/desktop-before-change-run', (launchContext) =>
    context.desktopRunActivation.beforeRun(launchContext),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['desktopRunActivation'] });

export default plugin;
