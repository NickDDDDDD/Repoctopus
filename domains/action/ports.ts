import type { ActionIntent, ActionReceipt, ClaimedActionOutcome } from './types.js';

export interface ActionStorePort {
  saveIntent(intent: ActionIntent): Promise<ActionIntent>;
  loadIntent(runId: string, workId: string, attempt?: number): Promise<ActionIntent>;
  loadLatestIntent(runId: string, workId: string): Promise<ActionIntent>;
  saveReceipt(receipt: ActionReceipt): Promise<ActionReceipt>;
  loadReceipt(runId: string, receiptId: string): Promise<ActionReceipt>;
}

export interface ActionAdapter {
  readonly id: string;
  complete(
    intent: ActionIntent,
    input: ClaimedActionOutcome & {
      receiptId: string;
      compositionDigest: string;
    },
  ): Promise<ActionReceipt>;
}
