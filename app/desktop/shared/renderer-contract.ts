import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';
import type { DesktopLaunchContext } from '../../../domains/desktop/launcher.js';
import type {
  ChangeProjectionDelta,
  ChangeProjectionSnapshot,
} from '../../../domains/telemetry/change-projection.js';

export const DESKTOP_IPC_CONTRACT_VERSION = 'repoctopus.desktop-ipc/v1' as const;
export const DESKTOP_IPC_MAX_PAYLOAD_BYTES = 1024;
export const DESKTOP_IPC_REQUESTS = Object.freeze({
  currentState: 'repoctopus:desktop-backend-state',
  retry: 'repoctopus:desktop-retry',
} as const);

export const DESKTOP_BACKEND_STATE_CHANNEL = DESKTOP_IPC_REQUESTS.currentState;
export const DESKTOP_RETRY_CHANNEL = DESKTOP_IPC_REQUESTS.retry;

export interface DesktopIpcRequest {
  apiVersion: typeof DESKTOP_IPC_CONTRACT_VERSION;
}

export function desktopIpcRequest(): DesktopIpcRequest {
  return Object.freeze({ apiVersion: DESKTOP_IPC_CONTRACT_VERSION });
}

export interface DesktopLaunchState {
  sequence: number;
  current: DesktopLaunchContext | null;
  history: readonly DesktopLaunchContext[];
}

export type DesktopShellState =
  | { phase: 'starting' }
  | {
      phase: 'ready';
      snapshot: DesktopApplicationSnapshot;
      projection: ChangeProjectionSnapshot;
      delta: ChangeProjectionDelta | null;
      launch: DesktopLaunchState;
    }
  | { phase: 'error'; message: string };

export interface RepoctopusDesktopBridge {
  currentState(): Promise<DesktopShellState>;
  retry(): void;
  onState(listener: (state: DesktopShellState) => void): () => void;
}
