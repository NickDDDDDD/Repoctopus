import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';
import type { DesktopLaunchContext } from '../../../domains/desktop/launcher.js';
import type {
  ChangeProjectionDelta,
  ChangeProjectionSnapshot,
} from '../../../domains/telemetry/change-projection.js';

export const DESKTOP_BACKEND_STATE_CHANNEL = 'repoctopus:desktop-backend-state';
export const DESKTOP_RETRY_CHANNEL = 'repoctopus:desktop-retry';

export type DesktopShellState =
  | { phase: 'starting' }
  | {
      phase: 'ready';
      snapshot: DesktopApplicationSnapshot;
      projection: ChangeProjectionSnapshot;
      delta: ChangeProjectionDelta | null;
      launchContext: DesktopLaunchContext | null;
    }
  | { phase: 'error'; message: string };

export interface RepoctopusDesktopBridge {
  currentState(): Promise<DesktopShellState>;
  retry(): void;
  onState(listener: (state: DesktopShellState) => void): () => void;
}
