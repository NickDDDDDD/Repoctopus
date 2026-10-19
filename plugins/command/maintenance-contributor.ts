import type { Context, Plugin } from '@deepseek-ai/cordis';

import { checkProvenance } from '../../platform/provenance/check.js';

export interface MaintenanceContributorConfig {
  productRoot: string;
}

const plugin = ((context: Context, config: MaintenanceContributorConfig) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'browser.doctor',
        execute: ({ input }) =>
          context.browserMaintenance.doctor((input as { workspace: string }).workspace),
      }),
      context.commandRouter.register({
        name: 'browser.install',
        execute: ({ input }) =>
          context.browserMaintenance.install((input as { workspace: string }).workspace),
      }),
      context.commandRouter.register({
        name: 'provenance.check',
        execute: () => checkProvenance(config.productRoot),
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, { inject: ['browserMaintenance', 'commandRouter'] });

export default plugin;
