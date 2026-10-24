import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { ActionAdapter } from '../../domains/action/ports.js';

const manualAdapter: ActionAdapter = {
  id: 'manual',
  complete(intent, input) {
    return Promise.resolve({
      schemaVersion: 2,
      receiptId: input.receiptId,
      intentId: intent.intentId,
      idempotencyKey: intent.idempotencyKey,
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
      claimToken: intent.claimToken,
      inputDigest: intent.inputDigest,
      outcomeId: input.outcomeId,
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
