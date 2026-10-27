import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';

export type DesktopReceiverConnection = Readonly<{
  schemaVersion: 1;
  endpoint: string;
  sessionToken: string;
}>;

export type DesktopHostEvent =
  | { type: 'ready'; snapshot: DesktopApplicationSnapshot; receiver: DesktopReceiverConnection }
  | { type: 'fatal'; message: string }
  | { type: 'shutdown-complete' };

export type DesktopShellCommand = { type: 'shutdown' };

export function isDesktopHostEvent(value: unknown): value is DesktopHostEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'shutdown-complete') return true;
  if (candidate.type === 'fatal') return typeof candidate.message === 'string';
  if (candidate.type !== 'ready') return false;
  if (typeof candidate.snapshot !== 'object' || candidate.snapshot === null) return false;
  const snapshot = candidate.snapshot as Record<string, unknown>;
  if (snapshot.apiVersion !== 'repoctopus.desktop/v1alpha1' || snapshot.phase !== 'ready') {
    return false;
  }
  if (typeof candidate.receiver !== 'object' || candidate.receiver === null) return false;
  const receiver = candidate.receiver as Record<string, unknown>;
  return (
    receiver.schemaVersion === 1 &&
    typeof receiver.endpoint === 'string' &&
    receiver.endpoint.startsWith('http://127.0.0.1:') &&
    typeof receiver.sessionToken === 'string' &&
    receiver.sessionToken.length >= 24
  );
}

export function isDesktopShellCommand(value: unknown): value is DesktopShellCommand {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'shutdown'
  );
}
