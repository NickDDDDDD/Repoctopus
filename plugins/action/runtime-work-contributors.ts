import { createHash } from 'node:crypto';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import { lifecycleContributorIdentity } from '../../domains/change-lifecycle/contributors.js';
import {
  outcomeReceiptAdapter,
  type WorkContributor,
} from '../../services/work-dispatcher.js';

function workContributor(id: string, requiredCapabilities: readonly string[]): WorkContributor {
  const digest = `sha256:${createHash('sha256')
    .update(`${id}\0${requiredCapabilities.join('\0')}`)
    .digest('hex')}` as const;
  return {
    id,
    identity: lifecycleContributorIdentity({
      kind: 'work',
      id: `repoctopus.${id}`,
      version: '1.0.0',
      codeDigest: digest,
      configDigest: digest,
    }),
    requiredCapabilities,
  };
}

const plugin = ((context: Context) => {
  context.effect(() =>
    context.workDispatcher.register(workContributor('manual', [])),
  );
  for (const entry of [
    { id: 'process', requiredCapabilities: ['process.execute'] },
    { id: 'git', requiredCapabilities: ['git.publish'] },
    { id: 'specification', requiredCapabilities: ['specification.write'] },
  ] as const) {
    context.effect(() => context.actionDispatcher.register(outcomeReceiptAdapter(entry.id)));
    context.effect(() =>
      context.workDispatcher.register(workContributor(entry.id, entry.requiredCapabilities)),
    );
  }
}) as Plugin;

Object.assign(plugin, { inject: ['actionDispatcher', 'workDispatcher'] });

export default plugin;
