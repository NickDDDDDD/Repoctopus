import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { ActionAdapter, ActionStorePort } from '../domains/action/ports.js';
import type { ActionIntent, ActionReceipt, ManualActionResult } from '../domains/action/types.js';
import type { EngineAction } from '../domains/engine/types.js';
import { compareCompositions } from '../domains/composition/compatibility.js';
import type { CompositionIdentitySnapshot } from '../domains/composition/types.js';

function identity(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export abstract class ActionStore extends Service implements ActionStorePort {
  protected abstract readonly port: ActionStorePort;

  constructor(context: Context) {
    super(context, 'actionStore');
  }

  saveIntent(intent: ActionIntent): Promise<ActionIntent> {
    return this.port.saveIntent(intent);
  }

  loadIntent(runId: string, actionId: string): Promise<ActionIntent> {
    return this.port.loadIntent(runId, actionId);
  }

  saveReceipt(receipt: ActionReceipt): Promise<ActionReceipt> {
    return this.port.saveReceipt(receipt);
  }

  loadReceipt(runId: string, receiptId: string): Promise<ActionReceipt> {
    return this.port.loadReceipt(runId, receiptId);
  }
}

export class ActionDispatcher extends Service {
  static inject = ['actionStore', 'compositionIdentity'];

  private readonly adapters = new Map<string, ActionAdapter>();

  constructor(context: Context) {
    super(context, 'actionDispatcher');
  }

  register(adapter: ActionAdapter): () => void {
    if (this.adapters.has(adapter.id))
      throw new Error(`Action adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id);
    };
  }

  async propose(
    runId: string,
    action: EngineAction,
    composition: CompositionIdentitySnapshot,
    adapter = 'manual',
  ): Promise<ActionIntent> {
    this.assertCompatibleComposition(composition);
    const compositionDigest = composition.compositionDigest;
    const idempotencyKey = identity(runId, action.id, adapter);
    return this.ctx.actionStore.saveIntent({
      schemaVersion: 1,
      intentId: identity('intent', idempotencyKey),
      idempotencyKey,
      runId,
      compositionDigest,
      composition: structuredClone(composition),
      action,
      adapter,
      createdAt: new Date().toISOString(),
    });
  }

  async completeManual(input: ManualActionResult): Promise<ActionReceipt> {
    const intent = await this.ctx.actionStore.loadIntent(input.runId, input.actionId);
    const current = this.ctx.compositionIdentity.current();
    this.assertCompatibleComposition(intent.composition);
    const adapter = this.adapters.get(intent.adapter);
    if (!adapter) throw new Error(`Action adapter is not active: ${intent.adapter}`);
    const receipt = await adapter.complete(intent, {
      status: input.status,
      summary: input.summary,
      eventId: input.eventId,
      compositionDigest: current.compositionDigest,
    });
    return this.ctx.actionStore.saveReceipt(receipt);
  }

  private assertCompatibleComposition(expected: CompositionIdentitySnapshot): void {
    const current = this.ctx.compositionIdentity.current();
    const compatibility = compareCompositions(expected, current);
    if (compatibility.status === 'migration_required') {
      throw new Error(
        `Action requires composition ${expected.compositionDigest}; current composition ${current.compositionDigest} is migration_required: ${compatibility.reason}`,
      );
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    actionStore: ActionStore;
    actionDispatcher: ActionDispatcher;
  }
}
