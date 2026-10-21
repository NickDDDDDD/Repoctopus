import { Service, type Context } from '@deepseek-ai/cordis';

import {
  acceptDelivery,
  claimDelivery,
  parseDeliveryEnvelope,
  renewDelivery,
  retryDeadLetterDelivery,
  settleDelivery,
} from '../domains/platform-events/inbox.js';
import type {
  EventInboxStore,
  PlatformEventTelemetryEvent,
  PlatformEventTelemetryEventType,
  PlatformEventTelemetryPort,
} from '../domains/platform-events/ports.js';
import type {
  EventInboxEntry,
  EventProcessingReceipt,
  PlatformDeliveryEnvelope,
  PlatformEventReplayResult,
  PlatformEventStatusView,
} from '../domains/platform-events/types.js';

export interface PlatformEventClaimInput {
  owner: string;
  timestamp: string;
  leaseMs: number;
}

export interface PlatformEventSettlementInput {
  envelopeId: string;
  leaseToken: string;
  timestamp: string;
  result: 'completed' | 'retry' | 'dead_letter';
  retryAt?: string;
  diagnostic?: string;
}

export interface PlatformEventLeaseRenewalInput {
  envelopeId: string;
  leaseToken: string;
  timestamp: string;
  leaseMs: number;
}

export interface PlatformEventProcessingResult {
  result: 'completed' | 'retry' | 'dead_letter';
  diagnostic?: string;
}

export interface PlatformEventProcessor {
  readonly id: string;
  readonly provider: string;
  readonly eventType: string;
  process(input: {
    envelope: PlatformDeliveryEnvelope;
    attempt: number;
    signal: AbortSignal;
  }): Promise<PlatformEventProcessingResult>;
}

const PROCESSING_RESULTS = new Set(['completed', 'retry', 'dead_letter']);
const DIAGNOSTIC_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,7}$/;

/** Provider-neutral ownership boundary for durable platform-event intake and processing state. */
export abstract class PlatformEvents extends Service {
  protected abstract readonly inbox: EventInboxStore;
  private readonly processors = new Map<string, PlatformEventProcessor>();

  constructor(
    context: Context,
    private readonly telemetry: PlatformEventTelemetryPort = { async export() {} },
  ) {
    super(context, 'platformEvents');
  }

  register(processor: PlatformEventProcessor): () => void {
    const key = this.processorKey(processor.provider, processor.eventType);
    if (!processor.id.trim() || !processor.provider.trim() || !processor.eventType.trim()) {
      throw new Error('Platform event processor identity is required');
    }
    if (this.processors.has(key)) {
      throw new Error(`Platform event processor already registered: ${key}`);
    }
    this.processors.set(key, processor);
    return () => {
      if (this.processors.get(key) === processor) this.processors.delete(key);
    };
  }

  async process(
    entry: EventInboxEntry,
    signal: AbortSignal,
  ): Promise<PlatformEventProcessingResult> {
    const processor = this.processors.get(
      this.processorKey(entry.envelope.provider, entry.envelope.eventType),
    );
    if (!processor) {
      return { result: 'dead_letter', diagnostic: 'no-platform-event-processor' };
    }
    const outcome: unknown = await processor.process({
      envelope: structuredClone(entry.envelope),
      attempt: entry.attempts,
      signal,
    });
    if (
      !outcome ||
      typeof outcome !== 'object' ||
      !('result' in outcome) ||
      typeof outcome.result !== 'string' ||
      !PROCESSING_RESULTS.has(outcome.result)
    ) {
      return { result: 'retry', diagnostic: 'platform-event-processor-result-invalid' };
    }
    const result = outcome.result as PlatformEventProcessingResult['result'];
    const diagnostic = 'diagnostic' in outcome ? outcome.diagnostic : undefined;
    return {
      result,
      ...(diagnostic === undefined ? {} : { diagnostic: this.diagnosticCode(diagnostic) }),
    };
  }

  async accept(
    envelope: PlatformDeliveryEnvelope,
    timestamp: string,
  ): Promise<{ duplicate: boolean; envelopeId: string }> {
    const accepted = await this.inbox.transaction(envelope.envelopeId, (current) => {
      const accepted = acceptDelivery(envelope, timestamp, current ?? undefined);
      return { entry: accepted.entry, result: accepted };
    });
    if (accepted === null) throw new Error('Event Inbox rejected the delivery');
    await this.emit(
      accepted.duplicate ? 'platform_event.deduplicated' : 'platform_event.accepted',
      accepted.entry,
      timestamp,
    );
    return { duplicate: accepted.duplicate, envelopeId: envelope.envelopeId };
  }

  async replay(
    value: unknown,
    timestamp = new Date().toISOString(),
  ): Promise<PlatformEventReplayResult> {
    const envelope = parseDeliveryEnvelope(value);
    const accepted = await this.accept(envelope, timestamp);
    return {
      apiVersion: 'repoctopus.platform-event/v1alpha1',
      kind: 'PlatformEventReplayResult',
      duplicate: accepted.duplicate,
      event: await this.status(envelope.envelopeId),
    };
  }

  async claimDue(input: PlatformEventClaimInput): Promise<EventInboxEntry | null> {
    const candidates = await this.inbox.listClaimable(input.timestamp);
    for (const candidate of candidates) {
      const claimed = await this.inbox.transaction(candidate.envelope.envelopeId, (current) => {
        if (!current) return null;
        const entry = claimDelivery({ entry: current, ...input });
        return entry ? { entry, result: entry } : null;
      });
      if (claimed) {
        await this.emit('platform_event.claimed', claimed, claimed.updatedAt);
        return claimed;
      }
    }
    return null;
  }

  async settle(input: PlatformEventSettlementInput): Promise<EventInboxEntry> {
    const diagnostic =
      input.diagnostic === undefined ? undefined : this.diagnosticCode(input.diagnostic);
    const settled = await this.inbox.transaction(input.envelopeId, (current) => {
      if (!current) return null;
      const result = settleDelivery({
        entry: current,
        leaseToken: input.leaseToken,
        timestamp: input.timestamp,
        result: input.result,
        ...(input.retryAt === undefined ? {} : { retryAt: input.retryAt }),
        ...(diagnostic === undefined ? {} : { diagnostic }),
      });
      return { ...result, result: result.entry };
    });
    if (!settled) throw new Error(`Event Inbox entry not found: ${input.envelopeId}`);
    await this.emit(
      input.result === 'completed'
        ? 'platform_event.completed'
        : input.result === 'retry'
          ? 'platform_event.retry_scheduled'
          : 'platform_event.dead_lettered',
      settled,
      input.timestamp,
    );
    return settled;
  }

  async renewLease(input: PlatformEventLeaseRenewalInput): Promise<EventInboxEntry> {
    const renewed = await this.inbox.transaction(input.envelopeId, (current) => {
      if (!current) return null;
      const entry = renewDelivery({ entry: current, ...input });
      return { entry, result: entry };
    });
    if (!renewed) throw new Error(`Event Inbox entry not found: ${input.envelopeId}`);
    return renewed;
  }

  load(envelopeId: string): Promise<EventInboxEntry | null> {
    return this.inbox.load(envelopeId);
  }

  receipts(envelopeId: string): Promise<EventProcessingReceipt[]> {
    return this.inbox.receipts(envelopeId);
  }

  async status(envelopeId: string): Promise<PlatformEventStatusView> {
    const snapshot = await this.inbox.inspect(envelopeId);
    if (!snapshot) throw new Error(`Event Inbox entry not found: ${envelopeId}`);
    const { entry, receipts } = snapshot;
    return {
      apiVersion: 'repoctopus.platform-event/v1alpha1',
      kind: 'PlatformEventStatus',
      envelopeId: entry.envelope.envelopeId,
      provider: entry.envelope.provider,
      source: entry.envelope.source,
      deliveryId: entry.envelope.deliveryId,
      eventType: entry.envelope.eventType,
      receivedAt: entry.envelope.receivedAt,
      payloadDigest: entry.envelope.payloadDigest,
      status: entry.status,
      attempts: entry.attempts,
      leaseExpiresAt: entry.lease?.expiresAt ?? null,
      nextAttemptAt: entry.nextAttemptAt,
      receiptId: entry.receiptId,
      diagnostic: entry.diagnostic,
      stateVersion: entry.stateVersion,
      updatedAt: entry.updatedAt,
      receipts,
    };
  }

  async retry(
    envelopeId: string,
    timestamp = new Date().toISOString(),
  ): Promise<PlatformEventStatusView> {
    const retried = await this.inbox.transaction(envelopeId, (current) => {
      if (!current) return null;
      const result = retryDeadLetterDelivery({ entry: current, timestamp });
      return { ...result, result: result.entry };
    });
    if (!retried) throw new Error(`Event Inbox entry not found: ${envelopeId}`);
    await this.emit('platform_event.manual_retry_requested', retried, timestamp);
    return this.status(envelopeId);
  }

  private processorKey(provider: string, eventType: string): string {
    return `${provider}\0${eventType}`;
  }

  private diagnosticCode(value: unknown): string {
    return typeof value === 'string' && value.length <= 96 && DIAGNOSTIC_CODE.test(value)
      ? value
      : 'platform-event-processor-diagnostic-redacted';
  }

  private async emit(
    type: PlatformEventTelemetryEventType,
    entry: EventInboxEntry,
    timestamp: string,
  ): Promise<void> {
    const event: PlatformEventTelemetryEvent = {
      schemaVersion: 1,
      type,
      timestamp,
      envelopeId: entry.envelope.envelopeId,
      provider: entry.envelope.provider,
      source: entry.envelope.source,
      deliveryId: entry.envelope.deliveryId,
      eventType: entry.envelope.eventType,
      status: entry.status,
      attempts: entry.attempts,
      stateVersion: entry.stateVersion,
      ...(entry.receiptId ? { receiptId: entry.receiptId } : {}),
      ...(entry.diagnostic ? { diagnostic: entry.diagnostic } : {}),
    };
    try {
      await this.telemetry.export(event);
    } catch {
      // Durable Inbox facts remain authoritative when observability is unavailable.
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformEvents: PlatformEvents;
  }
}
