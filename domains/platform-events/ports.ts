import type { EventInboxEntry, EventProcessingReceipt, PlatformDeliveryEnvelope } from './types.js';

export type PlatformEventTelemetryEventType =
  | 'platform_event.accepted'
  | 'platform_event.deduplicated'
  | 'platform_event.claimed'
  | 'platform_event.retry_scheduled'
  | 'platform_event.completed'
  | 'platform_event.dead_lettered'
  | 'platform_event.manual_retry_requested';

export interface PlatformEventTelemetryEvent {
  schemaVersion: 1;
  type: PlatformEventTelemetryEventType;
  timestamp: string;
  envelopeId: `sha256:${string}`;
  provider: string;
  source: string;
  deliveryId: string;
  eventType: string;
  status: EventInboxEntry['status'];
  attempts: number;
  stateVersion: number;
  receiptId?: `sha256:${string}`;
  diagnostic?: string;
}

export interface PlatformEventTelemetryPort {
  export(event: PlatformEventTelemetryEvent): Promise<void>;
}

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
  inspect(
    envelopeId: string,
  ): Promise<{ entry: EventInboxEntry; receipts: EventProcessingReceipt[] } | null>;
  listClaimable(timestamp: string): Promise<EventInboxEntry[]>;
  receipts(envelopeId: string): Promise<EventProcessingReceipt[]>;
  transaction<T>(
    envelopeId: string,
    update: (current: EventInboxEntry | null) => EventInboxMutation<T> | null,
  ): Promise<T | null>;
}
