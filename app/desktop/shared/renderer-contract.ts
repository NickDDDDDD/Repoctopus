import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';

export const DESKTOP_BACKEND_STATE_CHANNEL = 'repoctopus:desktop-backend-state';
export const DESKTOP_RETRY_CHANNEL = 'repoctopus:desktop-retry';
export const DESKTOP_RENDERER_PROTOCOL_VERSION = 1 as const;

export type DesktopShellState =
  | { protocolVersion: 1; phase: 'starting' }
  | { protocolVersion: 1; phase: 'ready'; snapshot: DesktopApplicationSnapshot }
  | { protocolVersion: 1; phase: 'error'; message: string };

export function isDesktopShellState(value: unknown): value is DesktopShellState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (state.protocolVersion !== DESKTOP_RENDERER_PROTOCOL_VERSION) return false;
  if (state.phase === 'starting') return true;
  if (state.phase === 'error') return typeof state.message === 'string' && state.message.length <= 4096;
  if (state.phase !== 'ready' || typeof state.snapshot !== 'object' || state.snapshot === null) {
    return false;
  }
  const snapshot = state.snapshot as Record<string, unknown>;
  return snapshot.apiVersion === 'repoctopus.desktop/v1alpha1' && snapshot.protocolVersion === 1;
}

export interface RepoctopusDesktopBridge {
  currentState(): Promise<DesktopShellState>;
  retry(): void;
  onState(listener: (state: DesktopShellState) => void): () => void;
}
