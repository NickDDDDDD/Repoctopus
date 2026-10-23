import type {
  DesktopApplicationSnapshot,
  DesktopProjectionDelta,
} from '../../../services/desktop-application.js';
import type { DesktopRunContext } from './activation-protocol.js';

export const DESKTOP_BACKEND_STATE_CHANNEL = 'repoctopus:desktop-backend-state';
export const DESKTOP_RETRY_CHANNEL = 'repoctopus:desktop-retry';
export const DESKTOP_PROJECTION_DELTA_CHANNEL = 'repoctopus:desktop-projection-delta';
export const DESKTOP_ACTIVATION_CONTEXT_CHANNEL = 'repoctopus:desktop-activation-context';

export type DesktopShellState =
  | { phase: 'starting' }
  | { phase: 'ready'; snapshot: DesktopApplicationSnapshot }
  | { phase: 'error'; message: string };

export interface RepoctopusDesktopBridge {
  currentState(): Promise<DesktopShellState>;
  retry(): void;
  onState(listener: (state: DesktopShellState) => void): () => void;
  onProjectionDelta(listener: (delta: DesktopProjectionDelta) => void): () => void;
  onActivation(listener: (context: DesktopRunContext) => void): () => void;
}
