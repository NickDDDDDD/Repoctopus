import type { ActionIntent, ActionReceipt } from './types.js';

export interface ActionStorePort {
  saveIntent(intent: ActionIntent): Promise<ActionIntent>;
  loadIntent(runId: string, actionId: string): Promise<ActionIntent>;
  saveReceipt(receipt: ActionReceipt): Promise<ActionReceipt>;
  loadReceipt(runId: string, receiptId: string): Promise<ActionReceipt>;
}

export interface ActionAdapter {
  readonly id: string;
  complete(
    intent: ActionIntent,
    input: {
      status: 'succeeded' | 'failed';
      summary: string;
      eventId: string;
      compositionDigest: string;
    },
  ): Promise<ActionReceipt>;
}
