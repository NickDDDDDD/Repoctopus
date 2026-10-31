import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { RuntimeDiagnostic } from '../domains/runtime/types.js';
import {
  desktopLaunchContextArgument,
  desktopLaunchContextUrl,
  type DesktopLaunchContext,
} from '../app/desktop/shared/launch-context.js';
import type { DesktopInstanceProbe } from '../app/desktop/shared/instance-probe.js';

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
      executable: string;
      arguments: readonly [string];
    };

export interface DesktopProcessHandle {
  once(event: 'spawn', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'spawn', listener: () => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  unref(): void;
  kill(): boolean;
}

export type DesktopProcessAdapter = (
  executable: string,
  arguments_: readonly string[],
  options: { detached: true; stdio: 'ignore'; windowsHide: true },
) => DesktopProcessHandle;

export type WindowsRegistryQuery = (
  executable: string,
  arguments_: readonly string[],
) => Promise<string>;

export interface DesktopLauncherConfig {
  productRoot: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  process?: DesktopProcessAdapter;
  pathExists?: (candidate: string) => Promise<boolean>;
  instanceProbe?: DesktopInstanceProbe;
  registryQuery?: WindowsRegistryQuery;
  launchDeadlineMs?: number;
}

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

const executeFile = promisify(execFile);
const DEFAULT_LAUNCH_DEADLINE_MS = 5_000;

function defaultProcessAdapter(
  executable: string,
  arguments_: readonly string[],
  options: { detached: true; stdio: 'ignore'; windowsHide: true },
): DesktopProcessHandle {
  return spawn(executable, [...arguments_], options);
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function defaultWindowsRegistryQuery(
  environment: NodeJS.ProcessEnv,
): WindowsRegistryQuery {
  return async (executable, arguments_) => {
    const result = await executeFile(executable, [...arguments_], {
      env: environment,
      windowsHide: true,
      timeout: 5_000,
    });
    return String(result.stdout);
  };
}

const WINDOWS_APP_PATH_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Repoctopus.exe';
const WINDOWS_PROTOCOL_COMMAND_KEY = 'HKCR\\repoctopus\\shell\\open\\command';

function registryStringValue(stdout: string): string | null {
  const values = stdout
    .split(/\r?\n/u)
    .map((line) => /^\s*.+?\s+REG_SZ\s+(.+?)\s*$/u.exec(line)?.[1]?.trim() ?? null)
    .filter((value): value is string => Boolean(value));
  return values.length === 1 ? values[0]! : null;
}

async function windowsAppPathExecutable(
  registryQuery: WindowsRegistryQuery,
  registryExecutable: string,
): Promise<string | null> {
  try {
    const stdout = await registryQuery(registryExecutable, [
      'query',
      WINDOWS_APP_PATH_KEY,
      '/ve',
    ]);
    return registryStringValue(stdout);
  } catch {
    return null;
  }
}

async function windowsProtocolHandlerAvailable(
  registryQuery: WindowsRegistryQuery,
  registryExecutable: string,
): Promise<boolean> {
  try {
    await registryQuery(registryExecutable, ['query', WINDOWS_PROTOCOL_COMMAND_KEY, '/ve']);
    return true;
  } catch {
    return false;
  }
}

function windowsSystemRoot(environment: NodeJS.ProcessEnv): string | null {
  const primary = environment.SystemRoot?.trim();
  const secondary = environment.SYSTEMROOT?.trim();
  if (primary && secondary && primary.toLowerCase() !== secondary.toLowerCase()) return null;
  const candidate = primary || secondary;
  if (!candidate || !path.win32.isAbsolute(candidate)) return null;
  const normalized = path.win32.normalize(candidate);
  if (normalized === path.win32.parse(normalized).root) return null;
  return normalized;
}

type TargetResolution =
  | { status: 'resolved'; target: DesktopLaunchTarget }
  | { status: 'unavailable'; targetKind: DesktopLaunchTargetKind; reason: DesktopActivationReason };

function unavailable(
  targetKind: DesktopLaunchTargetKind,
  reason: DesktopActivationReason,
): TargetResolution {
  return { status: 'unavailable', targetKind, reason };
}

/** Best-effort application boundary: launcher failure is observability loss, never workflow failure. */
export class DesktopLauncher extends Service {
  static inject = ['desktopInstanceProbe'];

  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly productRoot: string;
  private readonly process: DesktopProcessAdapter;
  private readonly pathExists: (candidate: string) => Promise<boolean>;
  private readonly instanceProbe: DesktopInstanceProbe;
  private readonly registryQuery: WindowsRegistryQuery;
  private readonly launchDeadlineMs: number;

  constructor(context: Context, config: DesktopLauncherConfig) {
    super(context, 'desktopLauncher');
    if (!config || !path.isAbsolute(config.productRoot)) {
      throw new Error('Desktop Launcher productRoot must be an absolute path');
    }
    this.environment = config.environment ?? process.env;
    this.platform = config.platform ?? process.platform;
    this.productRoot = path.resolve(config.productRoot);
    this.process = config.process ?? defaultProcessAdapter;
    this.pathExists = config.pathExists ?? fileExists;
    this.instanceProbe = config.instanceProbe ??
      context.get('desktopInstanceProbe') ?? { isAvailable: () => Promise.resolve(false) };
    this.registryQuery = config.registryQuery ?? defaultWindowsRegistryQuery(this.environment);
    this.launchDeadlineMs = config.launchDeadlineMs ?? DEFAULT_LAUNCH_DEADLINE_MS;
    if (!Number.isSafeInteger(this.launchDeadlineMs) || this.launchDeadlineMs <= 0) {
      throw new Error('Desktop Launcher launchDeadlineMs must be a positive safe integer');
    }
  }

  async activate(launchContext: DesktopLaunchContext): Promise<DesktopActivationResult> {
    if (this.platform !== 'win32') {
      return { status: 'unsupported', targetKind: 'none', reason: 'platform-unsupported' };
    }

    const resolution = await this.resolveTarget(launchContext);
    if (resolution.status === 'unavailable') {
      return {
        status: 'unavailable',
        targetKind: resolution.targetKind,
        reason: resolution.reason,
      };
    }
    const existingInstance = await this.instanceProbe.isAvailable();
    return this.requestActivation(resolution.target, existingInstance);
  }

  private async resolveTarget(launchContext: DesktopLaunchContext): Promise<TargetResolution> {
    const override = this.environment.REPOCTOPUS_DESKTOP_EXECUTABLE?.trim();
    if (override) {
      return {
        status: 'resolved',
        target: {
          kind: 'override',
          executable: override,
          arguments: [desktopLaunchContextArgument(launchContext)],
        },
      };
    }

    const electron = path.join(
      this.productRoot,
      'node_modules',
      'electron',
      'dist',
      'electron.exe',
    );
    const main = path.join(this.productRoot, 'dist', 'desktop', 'main.js');
    const [electronExists, mainExists] = await Promise.all([
      this.pathExists(electron),
      this.pathExists(main),
    ]);
    if (electronExists && mainExists) {
      return {
        status: 'resolved',
        target: {
          kind: 'source',
          executable: electron,
          arguments: [main, desktopLaunchContextArgument(launchContext)],
        },
      };
    }
    if (electronExists || mainExists) {
      return unavailable('source', 'development-artifact-missing');
    }
    const systemRoot = windowsSystemRoot(this.environment);
    if (systemRoot === null) {
      return unavailable('installed-protocol', 'target-unavailable');
    }
    const registryExecutable = path.win32.join(systemRoot, 'System32', 'reg.exe');
    const installedExecutable = await windowsAppPathExecutable(
      this.registryQuery,
      registryExecutable,
    );
    if (!installedExecutable || !path.win32.isAbsolute(installedExecutable)) {
      return unavailable('installed-protocol', 'target-unavailable');
    }
    const normalizedExecutable = path.win32.normalize(installedExecutable);
    if (
      path.win32.basename(normalizedExecutable).toLowerCase() !== 'repoctopus.exe' ||
      !(await this.pathExists(normalizedExecutable))
    ) {
      return unavailable('installed-protocol', 'target-unavailable');
    }
    if (!(await windowsProtocolHandlerAvailable(this.registryQuery, registryExecutable))) {
      return unavailable('installed-protocol', 'protocol-handler-unavailable');
    }
    return {
      status: 'resolved',
      target: {
        kind: 'installed-protocol',
        executable: normalizedExecutable,
        arguments: [desktopLaunchContextUrl(launchContext)],
      },
    };
  }

  private requestActivation(
    target: DesktopLaunchTarget,
    existingInstance: boolean,
  ): Promise<DesktopActivationResult> {
    try {
      const child = this.process(target.executable, target.arguments, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      return new Promise((resolve) => {
        let settled = false;
        const ignoreError = () => undefined;
        const finish = (result: DesktopActivationResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.removeListener('spawn', onSpawn);
          child.removeListener('error', onError);
          resolve(result);
        };
        const onSpawn = (): void => {
          try {
            child.unref();
            finish({
              status: existingInstance ? 'activated' : 'started',
              targetKind: target.kind,
              reason: existingInstance ? 'existing-instance' : 'new-instance',
            });
          } catch {
            finish({ status: 'unavailable', targetKind: target.kind, reason: 'launch-rejected' });
          }
        };
        const onError = (): void => {
          finish({ status: 'unavailable', targetKind: target.kind, reason: 'launch-rejected' });
        };
        child.on('error', ignoreError);
        child.once('spawn', onSpawn);
        child.once('error', onError);
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // The result is already bounded by launch-timeout.
          }
          finish({ status: 'unavailable', targetKind: target.kind, reason: 'launch-timeout' });
        }, this.launchDeadlineMs);
        timer.unref();
      });
    } catch {
      return Promise.resolve({
        status: 'unavailable',
        targetKind: target.kind,
        reason: 'launch-rejected',
      });
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopLauncher: DesktopLauncher;
  }
}
