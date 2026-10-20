import type { EventInboxEntry, EventProcessingReceipt } from './types.js';

export interface EventInboxMutation<T> {
  entry: EventInboxEntry;
  receipt?: EventProcessingReceipt;
  result: T;
}

/** Callbacks only compute state; external operations run outside the transaction. */
export interface EventInboxStore {
  load(envelopeId: string): Promise<EventInboxEntry | null>;
  receipts(envelopeId: string): Promise<EventProcessingReceipt[]>;
  transaction<T>(
    envelopeId: string,
    update: (current: EventInboxEntry | null) => EventInboxMutation<T> | null,
  ): Promise<T | null>;
}
