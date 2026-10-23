import { Service, type Context } from '@deepseek-ai/cordis';

import {
  ChangeProjectionReducer,
  type ChangeProjectionSnapshot,
  type ObservationRecord,
} from '../domains/telemetry/change-projection.js';
import type { DesktopRunContext } from '../app/desktop/shared/activation-protocol.js';
import type {
  DesktopTelemetryDiagnostic,
  DesktopTelemetrySignal,
} from './desktop-telemetry-receiver.js';

export const DESKTOP_APPLICATION_CONTRACT = 'repoctopus.desktop/v1alpha1' as const;

export interface DesktopApplicationSnapshot {
  apiVersion: typeof DESKTOP_APPLICATION_CONTRACT;
  phase: 'ready';
  projection: ChangeProjectionSnapshot;
  ingress: DesktopIngressSnapshot;
}

export interface DesktopIngressSnapshot {
  receiver: {
    status: 'ready' | 'receiving' | 'degraded';
    acceptedBatches: number;
    acceptedRecords: number;
    rejectedRequests: number;
    lastReceivedAt: string | null;
    lastDiagnosticCode: DesktopTelemetryDiagnostic['code'] | null;
    lastSignal: DesktopTelemetrySignal | null;
  };
  destination: {
    id: 'desktop-local';
    health: 'unknown' | 'healthy' | 'degraded';
    deliveryGuarantee: 'at-least-once';
  };
  replay: {
    status: 'idle' | 'catching-up';
    receivedRecords: number;
    totalRecords: number;
    startedAt: string | null;
    lastCompletedAt: string | null;
  };
}

export interface DesktopProjectionDelta {
  apiVersion: typeof DESKTOP_APPLICATION_CONTRACT;
  baseVersion: number;
  version: number;
  projection: ChangeProjectionSnapshot;
  ingress: DesktopIngressSnapshot;
}

export type DesktopProjectionListener = (delta: DesktopProjectionDelta) => void;

const STALE_AFTER_MS = 30_000;

function emptyIngress(): DesktopIngressSnapshot {
  return {
    receiver: {
      status: 'ready',
      acceptedBatches: 0,
      acceptedRecords: 0,
      rejectedRequests: 0,
      lastReceivedAt: null,
      lastDiagnosticCode: null,
      lastSignal: null,
    },
    destination: {
      id: 'desktop-local',
      health: 'unknown',
      deliveryGuarantee: 'at-least-once',
    },
    replay: {
      status: 'idle',
      receivedRecords: 0,
      totalRecords: 0,
      startedAt: null,
      lastCompletedAt: null,
    },
  };
}

export class DesktopApplication extends Service {
  private readonly reducer = new ChangeProjectionReducer();
  private readonly listeners = new Set<DesktopProjectionListener>();
  private ingress = emptyIngress();
  private projection = this.reducer.snapshot({
    now: new Date().toISOString(),
    staleAfterMs: STALE_AFTER_MS,
  });
  private version = 0;
  private freshnessTimer: ReturnType<typeof setTimeout> | undefined;
  private requestedContext: DesktopRunContext | null = null;

  constructor(context: Context) {
    super(context, 'desktopApplication');
    context.effect(() => () => {
      this.listeners.clear();
      if (this.freshnessTimer !== undefined) clearTimeout(this.freshnessTimer);
    });
  }

  snapshot(): DesktopApplicationSnapshot {
    return {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      phase: 'ready',
      projection: structuredClone(this.projection),
      ingress: structuredClone(this.ingress),
    };
  }

  accept(record: ObservationRecord, now = new Date().toISOString()): 'accepted' | 'duplicate' {
    const result = this.reducer.accept(record);
    if (result === 'duplicate') return result;
    this.commit(now);
    return result;
  }

  acceptBatch(
    records: readonly ObservationRecord[],
    input: { signal: DesktopTelemetrySignal; replay: boolean; receivedAt?: string },
  ): void {
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    this.updateIngress(receivedAt, (ingress) => {
      ingress.receiver.status = 'receiving';
      ingress.receiver.lastSignal = input.signal;
      if (input.replay) {
        ingress.replay = {
          status: 'catching-up',
          receivedRecords: 0,
          totalRecords: records.length,
          startedAt: receivedAt,
          lastCompletedAt: ingress.replay.lastCompletedAt,
        };
      }
    });
    try {
      let receivedRecords = 0;
      let acceptedRecords = 0;
      for (const record of records) {
        if (this.accept(record, receivedAt) === 'accepted') acceptedRecords += 1;
        receivedRecords += 1;
        if (input.replay) {
          this.ingress.replay.receivedRecords = receivedRecords;
        }
      }
      this.updateIngress(receivedAt, (ingress) => {
        ingress.receiver.status = 'ready';
        ingress.receiver.acceptedBatches += 1;
        ingress.receiver.acceptedRecords += acceptedRecords;
        ingress.receiver.lastReceivedAt = receivedAt;
        ingress.receiver.lastSignal = input.signal;
        ingress.destination.health = 'healthy';
        if (input.replay) {
          ingress.replay = {
            status: 'idle',
            receivedRecords: records.length,
            totalRecords: records.length,
            startedAt: null,
            lastCompletedAt: receivedAt,
          };
        }
      });
    } catch (error) {
      this.updateIngress(receivedAt, (ingress) => {
        ingress.receiver.status = 'degraded';
        ingress.receiver.lastDiagnosticCode = 'receiver-unavailable';
        ingress.destination.health = 'degraded';
        ingress.replay.status = 'idle';
        ingress.replay.startedAt = null;
      });
      throw error;
    }
  }

  reportReceiverDiagnostic(
    diagnostic: DesktopTelemetryDiagnostic,
    observedAt = new Date().toISOString(),
  ): void {
    this.updateIngress(observedAt, (ingress) => {
      ingress.receiver.rejectedRequests += 1;
      ingress.receiver.lastDiagnosticCode = diagnostic.code;
      ingress.receiver.lastSignal = diagnostic.signal;
      if (diagnostic.code === 'receiver-busy' || diagnostic.code === 'receiver-unavailable') {
        ingress.receiver.status = 'degraded';
        ingress.destination.health = 'degraded';
      }
    });
  }

  private commit(now: string): void {
    const baseVersion = this.version;
    this.version += 1;
    this.projection = {
      ...this.reducer.snapshot({ now, staleAfterMs: STALE_AFTER_MS }),
      version: this.version,
    };
    this.publish(baseVersion);
    this.scheduleFreshness(now);
  }

  private updateIngress(now: string, update: (ingress: DesktopIngressSnapshot) => void): void {
    const baseVersion = this.version;
    const next = structuredClone(this.ingress);
    update(next);
    this.ingress = next;
    this.version += 1;
    this.projection = { ...this.projection, version: this.version };
    this.publish(baseVersion);
    this.scheduleFreshness(now);
  }

  private publish(baseVersion: number): void {
    const delta: DesktopProjectionDelta = {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      baseVersion,
      version: this.version,
      projection: structuredClone(this.projection),
      ingress: structuredClone(this.ingress),
    };
    for (const listener of this.listeners) {
      try {
        listener(delta);
      } catch (error) {
        this.ctx.logger.warn('Desktop projection listener failed: %s', String(error));
      }
    }
  }

  private scheduleFreshness(now: string): void {
    if (this.freshnessTimer !== undefined) clearTimeout(this.freshnessTimer);
    this.freshnessTimer = undefined;
    const nowMs = Date.parse(now);
    const deadlines = this.projection.contexts
      .filter((context) => context.freshness === 'live')
      .map((context) => Date.parse(context.lastObservedAt) + STALE_AFTER_MS + 1)
      .filter((deadline) => deadline > nowMs);
    const deadline = deadlines.length === 0 ? undefined : Math.min(...deadlines);
    if (deadline === undefined) return;
    this.freshnessTimer = setTimeout(
      () => {
        this.freshnessTimer = undefined;
        const timestamp = new Date().toISOString();
        this.commit(timestamp);
      },
      Math.max(1, deadline - nowMs),
    );
    this.freshnessTimer.unref?.();
  }

  subscribe(listener: DesktopProjectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(context: DesktopRunContext): void {
    this.requestedContext = structuredClone(context);
  }

  activationContext(): DesktopRunContext | null {
    return this.requestedContext === null ? null : structuredClone(this.requestedContext);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopApplication: DesktopApplication;
  }
}
