import type { Plugin } from '@deepseek-ai/cordis';

const plugin = (() => undefined) as Plugin;

Object.assign(plugin, { inject: ['desktopApplication', 'desktopProjection', 'desktopReceiver'] });

export default plugin;
