import { Service, type Context } from '@deepseek-ai/cordis';

import {
  ChangeProjectionReducer,
  type ChangeProjectionSnapshot,
  type ObservationRecord,
} from '../domains/telemetry/change-projection.js';

export const DESKTOP_APPLICATION_CONTRACT = 'repoctopus.desktop/v1alpha1' as const;

export interface DesktopApplicationSnapshot {
  apiVersion: typeof DESKTOP_APPLICATION_CONTRACT;
  phase: 'ready';
  projection: ChangeProjectionSnapshot;
}

export interface DesktopProjectionDelta {
  apiVersion: typeof DESKTOP_APPLICATION_CONTRACT;
  baseVersion: number;
  version: number;
  projection: ChangeProjectionSnapshot;
}

export type DesktopProjectionListener = (delta: DesktopProjectionDelta) => void;

const STALE_AFTER_MS = 30_000;

export class DesktopApplication extends Service {
  private readonly reducer = new ChangeProjectionReducer();
  private readonly listeners = new Set<DesktopProjectionListener>();

  constructor(context: Context) {
    super(context, 'desktopApplication');
    context.effect(() => () => this.listeners.clear());
  }

  snapshot(now = new Date().toISOString()): DesktopApplicationSnapshot {
    return {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      phase: 'ready',
      projection: this.reducer.snapshot({ now, staleAfterMs: STALE_AFTER_MS }),
    };
  }

  accept(record: ObservationRecord, now = new Date().toISOString()): 'accepted' | 'duplicate' {
    const baseVersion = this.snapshot(now).projection.version;
    const result = this.reducer.accept(record);
    if (result === 'duplicate') return result;
    const projection = this.snapshot(now).projection;
    const delta: DesktopProjectionDelta = {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      baseVersion,
      version: projection.version,
      projection,
    };
    for (const listener of this.listeners) {
      try {
        listener(delta);
      } catch (error) {
        this.ctx.logger.warn('Desktop projection listener failed: %s', String(error));
      }
    }
    return result;
  }

  subscribe(listener: DesktopProjectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopApplication: DesktopApplication;
  }
}
