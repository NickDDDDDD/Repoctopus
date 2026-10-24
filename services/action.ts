import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { ActionAdapter, ActionStorePort } from '../domains/action/ports.js';
import type {
  ActionClaimInput,
  ActionIntent,
  ActionReceipt,
  ClaimedActionOutcome,
  ManualActionResult,
} from '../domains/action/types.js';
import type { EngineAction } from '../domains/engine/types.js';
import { compareCompositions } from '../domains/composition/compatibility.js';
import type { CompositionIdentitySnapshot } from '../domains/composition/types.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';

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

  loadIntent(runId: string, workId: string, attempt = 1): Promise<ActionIntent> {
    return this.port.loadIntent(runId, workId, attempt);
  }

  loadLatestIntent(runId: string, workId: string): Promise<ActionIntent> {
    return this.port.loadLatestIntent(runId, workId);
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
    const inputDigest = `sha256:${identity(
      'generic-action-input',
      runId,
      action.id,
      canonicalJson(action),
      composition.compositionDigest,
      adapter,
    )}` as const;
    return this.claim({
      runId,
      workId: action.id,
      attempt: 1,
      inputDigest,
      composition,
      action,
      adapter,
    });
  }

  async claim(input: ActionClaimInput): Promise<ActionIntent> {
    this.assertCompatibleComposition(input.composition);
    if (!input.runId.trim() || !input.workId.trim()) {
      throw new Error('Action claim requires Run and Work identities');
    }
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new Error('Action claim attempt must be a positive safe integer');
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.inputDigest)) {
      throw new Error('Action claim input digest must be a SHA-256 digest');
    }
    const adapter = input.adapter ?? 'manual';
    const compositionDigest = input.composition.compositionDigest;
    const idempotencyKey = identity(
      input.runId,
      input.workId,
      String(input.attempt),
      input.inputDigest,
      adapter,
    );
    return this.ctx.actionStore.saveIntent({
      schemaVersion: 2,
      intentId: identity('intent', idempotencyKey),
      idempotencyKey,
      runId: input.runId,
      workId: input.workId,
      attempt: input.attempt,
      claimToken: `sha256:${identity('claim', idempotencyKey)}`,
      inputDigest: input.inputDigest,
      compositionDigest,
      composition: structuredClone(input.composition),
      action: structuredClone(input.action),
      adapter,
      ...(input.executor ? { executor: structuredClone(input.executor) } : {}),
      ...(input.executionContext
        ? { executionContext: structuredClone(input.executionContext) }
        : {}),
      createdAt: new Date().toISOString(),
    });
  }

  async completeManual(input: ManualActionResult): Promise<ActionReceipt> {
    const intent = await this.ctx.actionStore.loadLatestIntent(input.runId, input.actionId);
    return this.complete({
      schemaVersion: 1,
      outcomeId: input.eventId,
      runId: intent.runId,
      workId: intent.workId,
      attempt: intent.attempt,
      claimToken: intent.claimToken,
      inputDigest: intent.inputDigest,
      status: input.status,
      summary: input.summary,
    });
  }

  async complete(input: ClaimedActionOutcome): Promise<ActionReceipt> {
    const intent = await this.ctx.actionStore.loadIntent(
      input.runId,
      input.workId,
      input.attempt,
    );
    const latest = await this.ctx.actionStore.loadLatestIntent(input.runId, input.workId);
    if (latest.attempt !== input.attempt || latest.intentId !== intent.intentId) {
      throw new Error(`Action Outcome belongs to a stale attempt: ${input.workId}`);
    }
    if (
      input.claimToken !== intent.claimToken ||
      input.inputDigest !== intent.inputDigest ||
      input.runId !== intent.runId ||
      input.workId !== intent.workId ||
      input.attempt !== intent.attempt
    ) {
      throw new Error('Action Outcome does not match its claimed Work');
    }
    const current = this.ctx.compositionIdentity.current();
    this.assertCompatibleComposition(intent.composition);
    const adapter = this.adapters.get(intent.adapter);
    if (!adapter) throw new Error(`Action adapter is not active: ${intent.adapter}`);
    const receiptId = identity('receipt', intent.intentId, input.outcomeId);
    try {
      return await this.ctx.actionStore.loadReceipt(input.runId, receiptId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const receipt = await adapter.complete(intent, {
      ...structuredClone(input),
      receiptId,
      compositionDigest: current.compositionDigest,
    });
    if (
      receipt.receiptId !== receiptId ||
      receipt.intentId !== intent.intentId ||
      receipt.runId !== input.runId ||
      receipt.workId !== input.workId ||
      receipt.attempt !== input.attempt ||
      receipt.claimToken !== input.claimToken ||
      receipt.inputDigest !== input.inputDigest ||
      receipt.outcomeId !== input.outcomeId
    ) {
      throw new Error('Action Adapter returned a Receipt for another claim or Outcome');
    }
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
