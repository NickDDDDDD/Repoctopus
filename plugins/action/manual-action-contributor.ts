import { createHash } from 'node:crypto';

import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { ActionAdapter } from '../../domains/action/ports.js';

const manualAdapter: ActionAdapter = {
  id: 'manual',
  complete(intent, input) {
    return Promise.resolve({
      schemaVersion: 1,
      receiptId: createHash('sha256')
        .update(['manual', intent.intentId, input.eventId].join('\0'))
        .digest('hex'),
      intentId: intent.intentId,
      idempotencyKey: intent.idempotencyKey,
      runId: intent.runId,
      compositionDigest: input.compositionDigest,
      actionId: intent.action.id,
      adapter: 'manual',
      outcome: input.status,
      summary: input.summary,
      completedAt: new Date().toISOString(),
    });
  },
};

const plugin = ((context: Context) => {
  context.effect(() => context.actionDispatcher.register(manualAdapter));
}) as Plugin;

Object.assign(plugin, {
  inject: ['actionDispatcher'],
});

export default plugin;
