import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';

export const DESKTOP_BACKEND_STATE_CHANNEL = 'repoctopus:desktop-backend-state';
export const DESKTOP_RETRY_CHANNEL = 'repoctopus:desktop-retry';

export type DesktopShellState =
  | { phase: 'starting' }
  | { phase: 'ready'; snapshot: DesktopApplicationSnapshot }
  | { phase: 'error'; message: string };

export interface RepoctopusDesktopBridge {
  currentState(): Promise<DesktopShellState>;
  retry(): void;
  onState(listener: (state: DesktopShellState) => void): () => void;
}
