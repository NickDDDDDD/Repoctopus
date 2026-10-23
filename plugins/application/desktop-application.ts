import type { Context, Plugin } from '@deepseek-ai/cordis';

const plugin = ((context: Context) => {
  context.effect(
    () => context.desktopTelemetryReceiver.acquireApplicationLease(),
    'repoctopus.desktop-application',
  );
}) as Plugin;

Object.assign(plugin, { inject: ['desktopApplication', 'desktopTelemetryReceiver'] });

export default plugin;
