import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = (async (context: Context) => {
  await context.desktopProjection.start();
  try {
    await context.desktopReceiver.start();
  } catch (error) {
    await context.desktopProjection.close();
    throw error;
  }
  return async () => {
    await context.desktopReceiver.stop();
    await context.desktopProjection.close();
  };
}) as Plugin;

Object.assign(plugin, {
  inject: ['desktopApplication', 'desktopProjection', 'desktopReceiver'],
});

export default plugin;
