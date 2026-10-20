import type {
  EventInboxEntry,
  EventProcessingReceipt,
  PlatformDeliveryEnvelope,
} from './types.js';

export interface PlatformWebhookRequest {
  method: string;
  contentType?: string;
  /** Lower-case names with every wire value preserved separately, matching Node headersDistinct. */
  headersDistinct: Readonly<Record<string, readonly string[] | undefined>>;
  body: Uint8Array;
}

/** Provider adapters authenticate raw requests and emit the shared delivery envelope. */
export interface PlatformWebhookAdapter {
  verify(request: PlatformWebhookRequest, receivedAt: string): Promise<PlatformDeliveryEnvelope>;
}

/** A route-scoped provider keeps webhook secrets separate from platform API tokens. */
export interface WebhookCredentialProvider {
  secret(): Promise<string>;
}

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
