import { createHash } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

export type LifecyclePhase =
  | 'boot'
  | 'pending'
  | 'loading'
  | 'active'
  | 'unloading'
  | 'failed'
  | 'disposed'
  | 'draining'
  | 'closed';

export interface LifecycleTelemetryEvent {
  schemaVersion: 1;
  sequence: number;
  eventId: string;
  type: 'app.lifecycle' | 'plugin.lifecycle' | 'operation.drain';
  bootId: string;
  compositionDigest: string;
  timestamp: string;
  phase: LifecyclePhase;
  result: 'started' | 'succeeded' | 'failed' | 'timed_out';
  pluginId?: string;
  service?: string;
  remaining?: number;
  recoverability?: 'journal_or_checkpoint' | 'client_retry';
}

export interface LifecycleTelemetryPort {
  export(events: readonly LifecycleTelemetryEvent[]): Promise<void>;
}

export type LifecycleDiagnostic =
  | {
      code: 'OPERATION_DRAIN_TIMEOUT';
      service: string;
      remaining: number;
      recoverability?: 'journal_or_checkpoint' | 'client_retry';
      timestamp: string;
    }
  | {
      code: 'LIFECYCLE_TELEMETRY_EXPORT_FAILED';
      service: 'lifecycleTelemetry';
      eventCount: number;
      attempts: number;
      disposition: 'dropped_after_retry';
      timestamp: string;
    };

export class LifecycleDiagnostics extends Service {
  private readonly entries: LifecycleDiagnostic[] = [];
  private readonly events: LifecycleTelemetryEvent[] = [];
  private exported = 0;

  constructor(
    context: Context,
    private readonly identity: { bootId: string; compositionDigest: string },
    private readonly telemetry: LifecycleTelemetryPort = { async export() {} },
  ) {
    super(context, 'lifecycleDiagnostics');
  }

  record(diagnostic: LifecycleDiagnostic): void {
    this.entries.push(Object.freeze({ ...diagnostic }));
  }

  snapshot(): readonly LifecycleDiagnostic[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  event(
    event: Omit<
      LifecycleTelemetryEvent,
      'schemaVersion' | 'sequence' | 'eventId' | 'bootId' | 'compositionDigest' | 'timestamp'
    >,
  ): void {
    const sequence = this.events.length + 1;
    const timestamp = new Date().toISOString();
    this.events.push({
      schemaVersion: 1,
      sequence,
      eventId: createHash('sha256')
        .update(
          [this.identity.bootId, String(sequence), event.type, event.phase, event.result].join(
            '\0',
          ),
        )
        .digest('hex'),
      ...event,
      ...this.identity,
      timestamp,
    });
  }

  eventSnapshot(): readonly LifecycleTelemetryEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  async flush(): Promise<void> {
    const pending = this.events.slice(this.exported);
    if (pending.length === 0) return;

    const attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.telemetry.export(pending);
        this.exported = this.events.length;
        return;
      } catch {
        if (attempt < attempts) continue;
        this.record({
          code: 'LIFECYCLE_TELEMETRY_EXPORT_FAILED',
          service: 'lifecycleTelemetry',
          eventCount: pending.length,
          attempts,
          disposition: 'dropped_after_retry',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lifecycleDiagnostics: LifecycleDiagnostics;
  }
}
