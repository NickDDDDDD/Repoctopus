import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { EventInboxEntry, EventProcessingReceipt, PlatformDeliveryEnvelope } from './types.js';

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export class EventInboxConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventInboxConflictError';
  }
}

export function deliveryEnvelope(input: {
  provider: string;
  source: string;
  deliveryId: string;
  eventType: string;
  receivedAt: string;
  payload: PlatformDeliveryEnvelope['payload'];
}): PlatformDeliveryEnvelope {
  for (const name of ['provider', 'source', 'deliveryId', 'eventType'] as const) {
    const value = input[name];
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  }
  const payload = structuredClone(input.payload);
  const payloadDigest = digest(payload);
  return {
    apiVersion: 'repoctopus.platform-event/v1alpha1',
    kind: 'PlatformDeliveryEnvelope',
    provider: input.provider,
    source: input.source,
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    receivedAt: input.receivedAt,
    payload,
    payloadDigest,
    envelopeId: digest({
      provider: input.provider,
      source: input.source,
      deliveryId: input.deliveryId,
    }),
  };
}

export function parseDeliveryEnvelope(value: unknown): PlatformDeliveryEnvelope {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (
      record.apiVersion !== 'repoctopus.platform-event/v1alpha1' ||
      record.kind !== 'PlatformDeliveryEnvelope' ||
      typeof record.provider !== 'string' ||
      typeof record.source !== 'string' ||
      typeof record.deliveryId !== 'string' ||
      typeof record.eventType !== 'string' ||
      typeof record.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.receivedAt)) ||
      new Date(record.receivedAt).toISOString() !== record.receivedAt ||
      !record.payload ||
      typeof record.payload !== 'object' ||
      Array.isArray(record.payload)
    ) {
      throw new Error();
    }
    const normalized = deliveryEnvelope({
      provider: record.provider,
      source: record.source,
      deliveryId: record.deliveryId,
      eventType: record.eventType,
      receivedAt: record.receivedAt,
      payload: record.payload as PlatformDeliveryEnvelope['payload'],
    });
    if (canonicalJson(normalized) !== canonicalJson(value)) throw new Error();
    return normalized;
  } catch {
    throw new Error('Replay input must be a canonical PlatformDeliveryEnvelope');
  }
}

export function acceptDelivery(
  envelope: PlatformDeliveryEnvelope,
  timestamp: string,
  existing?: EventInboxEntry,
): { entry: EventInboxEntry; duplicate: boolean } {
  if (existing) {
    if (existing.envelope.envelopeId !== envelope.envelopeId) {
      throw new EventInboxConflictError('Inbox identity mismatch');
    }
    if (
      existing.envelope.payloadDigest !== envelope.payloadDigest ||
      existing.envelope.eventType !== envelope.eventType
    ) {
      throw new EventInboxConflictError('Platform reused a Delivery ID with different payload');
    }
    return { entry: structuredClone(existing), duplicate: true };
  }
  return {
    duplicate: false,
    entry: {
      schemaVersion: 1,
      envelope: structuredClone(envelope),
      status: 'pending',
      attempts: 0,
      lease: null,
      nextAttemptAt: null,
      receiptId: null,
      diagnostic: null,
      stateVersion: 0,
      updatedAt: timestamp,
    },
  };
}

export function claimDelivery(input: {
  entry: EventInboxEntry;
  owner: string;
  timestamp: string;
  leaseMs: number;
  token?: string;
}): EventInboxEntry | null {
  const now = Date.parse(input.timestamp);
  if (!Number.isFinite(now) || !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1) {
    throw new Error('Valid claim timestamp and lease are required');
  }
  const { entry } = input;
  if (entry.status === 'completed' || entry.status === 'dead_letter') return null;
  if (entry.status === 'leased' && entry.lease && Date.parse(entry.lease.expiresAt) > now)
    return null;
  if (
    entry.status === 'retry_wait' &&
    entry.nextAttemptAt &&
    Date.parse(entry.nextAttemptAt) > now
  ) {
    return null;
  }
  return {
    ...structuredClone(entry),
    status: 'leased',
    attempts: entry.attempts + 1,
    lease: {
      owner: input.owner,
      token: input.token ?? randomUUID(),
      expiresAt: new Date(now + input.leaseMs).toISOString(),
    },
    nextAttemptAt: null,
    stateVersion: entry.stateVersion + 1,
    updatedAt: input.timestamp,
  };
}

function assertLease(entry: EventInboxEntry, token: string): void {
  if (entry.status !== 'leased' || entry.lease?.token !== token) {
    throw new Error('Event processing lease does not match');
  }
}

export function renewDelivery(input: {
  entry: EventInboxEntry;
  leaseToken: string;
  timestamp: string;
  leaseMs: number;
}): EventInboxEntry {
  assertLease(input.entry, input.leaseToken);
  const now = Date.parse(input.timestamp);
  if (
    !Number.isFinite(now) ||
    now < Date.parse(input.entry.updatedAt) ||
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1
  ) {
    throw new Error('Valid lease renewal timestamp and duration are required');
  }
  if (now >= Date.parse(input.entry.lease!.expiresAt)) {
    throw new Error('Event processing lease has expired');
  }
  return {
    ...structuredClone(input.entry),
    lease: {
      ...input.entry.lease!,
      expiresAt: new Date(now + input.leaseMs).toISOString(),
    },
    stateVersion: input.entry.stateVersion + 1,
    updatedAt: input.timestamp,
  };
}

export function settleDelivery(input: {
  entry: EventInboxEntry;
  leaseToken: string;
  timestamp: string;
  result: 'completed' | 'retry' | 'dead_letter';
  retryAt?: string;
  diagnostic?: string;
}): { entry: EventInboxEntry; receipt: EventProcessingReceipt } {
  assertLease(input.entry, input.leaseToken);
  const now = Date.parse(input.timestamp);
  if (!Number.isFinite(now) || now < Date.parse(input.entry.updatedAt)) {
    throw new Error('Valid settlement timestamp is required');
  }
  if (now >= Date.parse(input.entry.lease!.expiresAt)) {
    throw new Error('Event processing lease has expired');
  }
  if (input.result === 'retry' && !input.retryAt) throw new Error('Retry settlement needs retryAt');
  if (
    input.result === 'retry' &&
    (!Number.isFinite(Date.parse(input.retryAt!)) || Date.parse(input.retryAt!) <= now)
  ) {
    throw new Error('Retry must be scheduled after settlement');
  }
  const receiptBase = {
    envelopeId: input.entry.envelope.envelopeId,
    result: input.result,
    attempt: input.entry.attempts,
    completedAt: input.timestamp,
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
  } as const;
  const receipt: EventProcessingReceipt = {
    schemaVersion: 1,
    receiptId: digest(receiptBase),
    ...receiptBase,
  };
  return {
    receipt,
    entry: {
      ...structuredClone(input.entry),
      status:
        input.result === 'completed'
          ? 'completed'
          : input.result === 'retry'
            ? 'retry_wait'
            : 'dead_letter',
      lease: null,
      nextAttemptAt: input.result === 'retry' ? input.retryAt! : null,
      receiptId: receipt.receiptId,
      diagnostic: input.diagnostic ?? null,
      stateVersion: input.entry.stateVersion + 1,
      updatedAt: input.timestamp,
    },
  };
}

export function retryDeadLetterDelivery(input: { entry: EventInboxEntry; timestamp: string }): {
  entry: EventInboxEntry;
  receipt: EventProcessingReceipt;
} {
  if (input.entry.status !== 'dead_letter') {
    throw new Error('Only a dead-letter platform event can be retried manually');
  }
  const now = Date.parse(input.timestamp);
  if (!Number.isFinite(now) || now < Date.parse(input.entry.updatedAt)) {
    throw new Error('Valid manual retry timestamp is required');
  }
  const receiptBase = {
    envelopeId: input.entry.envelope.envelopeId,
    result: 'retry' as const,
    attempt: input.entry.attempts,
    completedAt: input.timestamp,
    diagnostic: 'manual-retry-requested',
  };
  const receipt: EventProcessingReceipt = {
    schemaVersion: 1,
    receiptId: digest(receiptBase),
    ...receiptBase,
  };
  return {
    receipt,
    entry: {
      ...structuredClone(input.entry),
      status: 'retry_wait',
      lease: null,
      nextAttemptAt: input.timestamp,
      receiptId: receipt.receiptId,
      diagnostic: receipt.diagnostic!,
      stateVersion: input.entry.stateVersion + 1,
      updatedAt: input.timestamp,
    },
  };
}
