import { spawn } from 'node:child_process';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { RuntimeDiagnostic } from '../domains/runtime/types.js';
import {
  desktopLaunchContextArgument,
  type DesktopLaunchContext,
} from '../app/desktop/shared/launch-context.js';

export const DESKTOP_ACTIVATION_STATUSES = [
  'started',
  'activated',
  'unavailable',
  'unsupported',
] as const;
export type DesktopActivationStatus = (typeof DESKTOP_ACTIVATION_STATUSES)[number];

export const DESKTOP_LAUNCH_TARGET_KINDS = [
  'override',
  'source',
  'installed-protocol',
  'none',
] as const;
export type DesktopLaunchTargetKind = (typeof DESKTOP_LAUNCH_TARGET_KINDS)[number];

export const DESKTOP_ACTIVATION_REASONS = [
  'new-instance',
  'existing-instance',
  'target-unavailable',
  'development-artifact-missing',
  'protocol-handler-unavailable',
  'launch-rejected',
  'launch-timeout',
  'platform-unsupported',
] as const;
export type DesktopActivationReason = (typeof DESKTOP_ACTIVATION_REASONS)[number];

export interface DesktopActivationResult {
  status: DesktopActivationStatus;
  targetKind: DesktopLaunchTargetKind;
  reason: DesktopActivationReason;
}

export type DesktopLaunchTarget =
  | {
      kind: Exclude<DesktopLaunchTargetKind, 'installed-protocol' | 'none'>;
      executable: string;
      arguments: readonly string[];
    }
  | {
      kind: 'installed-protocol';
      executable: 'explorer.exe';
      arguments: readonly [string];
    };

const RESULT_FIELDS = new Set(['status', 'targetKind', 'reason']);
const STATUS_REASONS: Readonly<
  Record<DesktopActivationStatus, readonly DesktopActivationReason[]>
> = {
  started: ['new-instance'],
  activated: ['existing-instance'],
  unavailable: [
    'target-unavailable',
    'development-artifact-missing',
    'protocol-handler-unavailable',
    'launch-rejected',
    'launch-timeout',
  ],
  unsupported: ['platform-unsupported'],
};

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`Desktop activation ${label} is invalid`);
  }
  return value as T;
}

export function parseDesktopActivationResult(value: unknown): DesktopActivationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Desktop activation result must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !RESULT_FIELDS.has(key))) {
    throw new Error('Desktop activation result contains an unknown field');
  }
  const status = enumValue(candidate.status, DESKTOP_ACTIVATION_STATUSES, 'status');
  const targetKind = enumValue(candidate.targetKind, DESKTOP_LAUNCH_TARGET_KINDS, 'target kind');
  const reason = enumValue(candidate.reason, DESKTOP_ACTIVATION_REASONS, 'reason');
  if (!STATUS_REASONS[status].includes(reason)) {
    throw new Error('Desktop activation reason does not match status');
  }
  if (
    ((status === 'started' || status === 'activated') && targetKind === 'none') ||
    (status === 'unsupported' && targetKind !== 'none')
  ) {
    throw new Error('Desktop activation target kind does not match status');
  }
  return { status, targetKind, reason };
}

const DIAGNOSTICS: Readonly<Record<DesktopActivationStatus, RuntimeDiagnostic>> = {
  started: {
    level: 'info',
    code: 'desktop.activation.started',
    message: 'Repoctopus Desktop start request was accepted',
  },
  activated: {
    level: 'info',
    code: 'desktop.activation.activated',
    message: 'Repoctopus Desktop activation request was accepted',
  },
  unavailable: {
    level: 'warning',
    code: 'desktop.activation.unavailable',
    message: 'Repoctopus Desktop activation target is unavailable',
  },
  unsupported: {
    level: 'warning',
    code: 'desktop.activation.unsupported',
    message: 'Repoctopus Desktop activation is unsupported on this platform',
  },
};

export function desktopActivationDiagnostic(result: DesktopActivationResult): RuntimeDiagnostic {
  const parsed = parseDesktopActivationResult(result);
  return { ...DIAGNOSTICS[parsed.status] };
}

/** Best-effort application boundary: launcher failure is observability loss, never workflow failure. */
export class DesktopLauncher extends Service {
  constructor(
    context: Context,
    private readonly config: { environment?: NodeJS.ProcessEnv } = {},
  ) {
    super(context, 'desktopLauncher');
  }

  activate(launchContext: DesktopLaunchContext): DesktopActivationResult {
    const environment = this.config.environment ?? process.env;
    const executable = environment.REPOCTOPUS_DESKTOP_EXECUTABLE?.trim();
    if (!executable) {
      return { status: 'unavailable', targetKind: 'none', reason: 'target-unavailable' };
    }
    try {
      const child = spawn(executable, [desktopLaunchContextArgument(launchContext)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { status: 'started', targetKind: 'override', reason: 'new-instance' };
    } catch {
      return { status: 'unavailable', targetKind: 'override', reason: 'launch-rejected' };
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopLauncher: DesktopLauncher;
  }
}
