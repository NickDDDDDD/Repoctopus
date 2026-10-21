import type { Plugin } from '@deepseek-ai/cordis';

const plugin = (() => undefined) as Plugin;

Object.assign(plugin, { inject: ['httpHost', 'platformEventRunner'] });

export default plugin;
