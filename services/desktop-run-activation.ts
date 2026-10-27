import type { RuntimeDiagnostic } from '../domains/runtime/types.js';
import {
  normalizeDesktopLaunchContext,
  type DesktopLaunchContext,
  type DesktopLauncher,
} from '../domains/desktop/launcher.js';

export type DesktopReplayWake = (context: DesktopLaunchContext) => Promise<void>;

export interface DesktopRunActivationResult {
  status: 'ready' | 'warning' | 'unsupported';
  diagnostics: RuntimeDiagnostic[];
}

function errorCategory(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,48}$/u.test(code) ? code : 'unknown';
}

function warning(code: string, message: string): RuntimeDiagnostic {
  return { level: 'warning', code, message };
}

/**
 * Best-effort boundary run before a development Run. Desktop availability can
 * add observability, but it can never become a prerequisite for domain work.
 */
export class DesktopRunActivation {
  constructor(
    private readonly launcher: DesktopLauncher,
    private readonly wakeReplay: DesktopReplayWake,
  ) {}

  async beforeRun(context: DesktopLaunchContext): Promise<DesktopRunActivationResult> {
    const normalized = normalizeDesktopLaunchContext(context);
    let activation;
    try {
      activation = await this.launcher.activate(normalized);
    } catch (error) {
      return {
        status: 'warning',
        diagnostics: [
          warning(
            'desktop.launch-failed',
            `Desktop Dashboard could not be started or activated (${errorCategory(error)}); the development Run will continue.`,
          ),
        ],
      };
    }

    if (activation.status === 'unsupported') {
      return {
        status: 'unsupported',
        diagnostics: [
          warning(
            'desktop.platform-unsupported',
            `Desktop Dashboard is not supported on ${activation.platform}; the development Run will continue.`,
          ),
        ],
      };
    }

    try {
      await this.wakeReplay(normalized);
      return { status: 'ready', diagnostics: [] };
    } catch (error) {
      return {
        status: 'warning',
        diagnostics: [
          warning(
            'desktop.replay-wake-failed',
            `Desktop telemetry replay could not be woken (${errorCategory(error)}); its cursor remains retryable and the development Run will continue.`,
          ),
        ],
      };
    }
  }
}
