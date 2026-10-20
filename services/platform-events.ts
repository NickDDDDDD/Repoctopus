import { Service, type Context } from '@deepseek-ai/cordis';

import {
  acceptDelivery,
  claimDelivery,
  renewDelivery,
  settleDelivery,
} from '../domains/platform-events/inbox.js';
import type { EventInboxStore } from '../domains/platform-events/ports.js';
import type {
  EventInboxEntry,
  EventProcessingReceipt,
  PlatformDeliveryEnvelope,
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

  constructor(context: Context) {
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
    const duplicate = await this.inbox.transaction(envelope.envelopeId, (current) => {
      const accepted = acceptDelivery(envelope, timestamp, current ?? undefined);
      return { entry: accepted.entry, result: accepted.duplicate };
    });
    if (duplicate === null) throw new Error('Event Inbox rejected the delivery');
    return { duplicate, envelopeId: envelope.envelopeId };
  }

  async claimDue(input: PlatformEventClaimInput): Promise<EventInboxEntry | null> {
    const candidates = await this.inbox.listClaimable(input.timestamp);
    for (const candidate of candidates) {
      const claimed = await this.inbox.transaction(candidate.envelope.envelopeId, (current) => {
        if (!current) return null;
        const entry = claimDelivery({ entry: current, ...input });
        return entry ? { entry, result: entry } : null;
      });
      if (claimed) return claimed;
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

  private processorKey(provider: string, eventType: string): string {
    return `${provider}\0${eventType}`;
  }

  private diagnosticCode(value: unknown): string {
    return typeof value === 'string' && value.length <= 96 && DIAGNOSTIC_CODE.test(value)
      ? value
      : 'platform-event-processor-diagnostic-redacted';
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformEvents: PlatformEvents;
  }
}
