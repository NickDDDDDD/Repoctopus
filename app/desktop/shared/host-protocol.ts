import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';
import { parseDesktopLaunchContext, type DesktopLaunchContext } from './launch-context.js';
import {
  isChangeProjectionDelta,
  isChangeProjectionSnapshot,
  type ChangeProjectionDelta,
  type ChangeProjectionSnapshot,
} from '../../../domains/trajectory/projection.js';
import type { DesktopReceiverConnection } from '../../../services/desktop-receiver.js';

export const DESKTOP_HOST_PROTOCOL_VERSION = 1 as const;
const MAX_HOST_MESSAGE_CHARS = 64 * 1024;

export type DesktopHostEvent =
  | {
      protocolVersion: 1;
      type: 'ready';
      snapshot: DesktopApplicationSnapshot;
      receiver: DesktopReceiverConnection;
      projection: ChangeProjectionSnapshot;
    }
  | { protocolVersion: 1; type: 'snapshot-updated'; snapshot: DesktopApplicationSnapshot }
  | {
      protocolVersion: 1;
      type: 'projection-updated';
      snapshot: ChangeProjectionSnapshot;
      delta: ChangeProjectionDelta;
    }
  | { protocolVersion: 1; type: 'fatal'; message: string }
  | { protocolVersion: 1; type: 'shutdown-complete' };

export type DesktopShellCommand =
  | { protocolVersion: 1; type: 'shutdown' }
  | { protocolVersion: 1; type: 'activate-context'; context: DesktopLaunchContext }
  | { protocolVersion: 1; type: 'select-change'; selection: DesktopLaunchContext };

function boundedMessage(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_HOST_MESSAGE_CHARS;
  } catch {
    return false;
  }
}

export function isDesktopHostEvent(value: unknown): value is DesktopHostEvent {
  if (!boundedMessage(value) || value.protocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION)
    return false;
  const candidate = value;
  if (candidate.type === 'shutdown-complete') return true;
  if (candidate.type === 'fatal') {
    return (
      typeof candidate.message === 'string' && candidate.message.length <= MAX_HOST_MESSAGE_CHARS
    );
  }
  if (candidate.type === 'projection-updated') {
    return (
      isChangeProjectionSnapshot(candidate.snapshot) && isChangeProjectionDelta(candidate.delta)
    );
  }
  if (candidate.type !== 'ready' && candidate.type !== 'snapshot-updated') return false;
  if (typeof candidate.snapshot !== 'object' || candidate.snapshot === null) return false;
  const snapshot = candidate.snapshot as Record<string, unknown>;
  const validSnapshot =
    snapshot.apiVersion === 'repoctopus.desktop/v1alpha1' &&
    snapshot.protocolVersion === DESKTOP_HOST_PROTOCOL_VERSION &&
    snapshot.phase === 'ready';
  if (!validSnapshot || candidate.type !== 'ready') return validSnapshot;
  if (typeof candidate.receiver !== 'object' || candidate.receiver === null) return false;
  const receiver = candidate.receiver as Record<string, unknown>;
  return (
    receiver.schemaVersion === 1 &&
    typeof receiver.endpoint === 'string' &&
    /^http:\/\/127\.0\.0\.1:\d+$/u.test(receiver.endpoint) &&
    typeof receiver.sessionToken === 'string' &&
    receiver.sessionToken.length >= 24 &&
    isChangeProjectionSnapshot(candidate.projection)
  );
}

export function isDesktopShellCommand(value: unknown): value is DesktopShellCommand {
  if (!boundedMessage(value) || value.protocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION)
    return false;
  if (value.type === 'shutdown') return true;
  if (value.type !== 'activate-context' && value.type !== 'select-change') return false;
  try {
    parseDesktopLaunchContext(value.type === 'activate-context' ? value.context : value.selection);
    return true;
  } catch {
    return false;
  }
}
