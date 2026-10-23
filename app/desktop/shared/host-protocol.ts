import type {
  DesktopApplicationSnapshot,
  DesktopProjectionDelta,
} from '../../../services/desktop-application.js';
import type { DesktopTelemetryEndpoint } from '../../../services/desktop-telemetry-receiver.js';

export type DesktopHostEvent =
  | {
      type: 'ready';
      snapshot: DesktopApplicationSnapshot;
      receiver: DesktopTelemetryEndpoint;
    }
  | { type: 'projection.delta'; delta: DesktopProjectionDelta }
  | { type: 'fatal'; message: string }
  | { type: 'shutdown-complete' };

export type DesktopShellCommand = { type: 'shutdown' };

function isProjection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const projection = value as Record<string, unknown>;
  return (
    projection.schemaVersion === 1 &&
    Number.isSafeInteger(projection.version) &&
    typeof projection.gap === 'object' &&
    projection.gap !== null &&
    ['empty', 'live', 'stale'].includes(String(projection.freshness))
  );
}

function isSnapshot(value: unknown): value is DesktopApplicationSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.apiVersion === 'repoctopus.desktop/v1alpha1' &&
    snapshot.phase === 'ready' &&
    isProjection(snapshot.projection)
  );
}

function isDelta(value: unknown): value is DesktopProjectionDelta {
  if (!value || typeof value !== 'object') return false;
  const delta = value as Record<string, unknown>;
  return (
    delta.apiVersion === 'repoctopus.desktop/v1alpha1' &&
    Number.isSafeInteger(delta.baseVersion) &&
    Number.isSafeInteger(delta.version) &&
    delta.version === (delta.projection as Record<string, unknown> | undefined)?.version &&
    isProjection(delta.projection)
  );
}

function isReceiver(value: unknown): value is DesktopTelemetryEndpoint {
  if (!value || typeof value !== 'object') return false;
  const receiver = value as Record<string, unknown>;
  if (
    typeof receiver.origin !== 'string' ||
    typeof receiver.authorization !== 'string' ||
    !/^Bearer [A-Za-z0-9_-]{43,128}$/u.test(receiver.authorization)
  ) {
    return false;
  }
  try {
    const origin = new URL(receiver.origin);
    return (
      origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.pathname === '/'
    );
  } catch {
    return false;
  }
}

export function isDesktopHostEvent(value: unknown): value is DesktopHostEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'shutdown-complete') return true;
  if (candidate.type === 'fatal') return typeof candidate.message === 'string';
  if (candidate.type === 'projection.delta') return isDelta(candidate.delta);
  if (candidate.type !== 'ready') return false;
  return isSnapshot(candidate.snapshot) && isReceiver(candidate.receiver);
}

export function isDesktopShellCommand(value: unknown): value is DesktopShellCommand {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'shutdown'
  );
}
