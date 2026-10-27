import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = (async (context: Context) => {
  await context.desktopReceiver.start();
  return () => context.desktopReceiver.stop();
}) as Plugin;

Object.assign(plugin, {
  inject: ['desktopApplication', 'desktopProjection', 'desktopReceiver'],
});

export default plugin;
