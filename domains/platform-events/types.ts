export const PLATFORM_EVENT_API_VERSION = 'repoctopus.platform-event/v1alpha1' as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PlatformDeliveryEnvelope {
  apiVersion: typeof PLATFORM_EVENT_API_VERSION;
  kind: 'PlatformDeliveryEnvelope';
  provider: string;
  source: string;
  deliveryId: string;
  eventType: string;
  receivedAt: string;
  payload: { [key: string]: JsonValue };
  payloadDigest: `sha256:${string}`;
  envelopeId: `sha256:${string}`;
}

export type InboxStatus = 'pending' | 'leased' | 'retry_wait' | 'completed' | 'dead_letter';

export interface EventInboxEntry {
  schemaVersion: 1;
  envelope: PlatformDeliveryEnvelope;
  status: InboxStatus;
  attempts: number;
  lease: { owner: string; token: string; expiresAt: string } | null;
  nextAttemptAt: string | null;
  receiptId: `sha256:${string}` | null;
  diagnostic: string | null;
  stateVersion: number;
  updatedAt: string;
}

export interface EventProcessingReceipt {
  schemaVersion: 1;
  receiptId: `sha256:${string}`;
  envelopeId: `sha256:${string}`;
  result: 'completed' | 'retry' | 'dead_letter';
  attempt: number;
  completedAt: string;
  diagnostic?: string;
}

export interface PlatformEventStatusView {
  apiVersion: typeof PLATFORM_EVENT_API_VERSION;
  kind: 'PlatformEventStatus';
  envelopeId: `sha256:${string}`;
  provider: string;
  source: string;
  deliveryId: string;
  eventType: string;
  receivedAt: string;
  payloadDigest: `sha256:${string}`;
  status: InboxStatus;
  attempts: number;
  leaseExpiresAt: string | null;
  nextAttemptAt: string | null;
  receiptId: string | null;
  diagnostic: string | null;
  stateVersion: number;
  updatedAt: string;
  receipts: EventProcessingReceipt[];
}

export interface PlatformEventReplayResult {
  apiVersion: typeof PLATFORM_EVENT_API_VERSION;
  kind: 'PlatformEventReplayResult';
  duplicate: boolean;
  event: PlatformEventStatusView;
}
