import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DesktopReceiverConnection } from '../../app/desktop/shared/host-protocol.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';
import {
  inspectProcessOwnership,
  readProcessIdentity,
  type ProcessOwnership,
} from '../process/process-identity.js';

const execute = promisify(execFile);

export const DESKTOP_RECEIVER_DISCOVERY_PROTOCOL =
  'repoctopus.desktop.receiver-discovery/v1' as const;
export const DEFAULT_DESKTOP_DISCOVERY_MAX_AGE_MS = 45_000;
const MAX_DISCOVERY_BYTES = 8 * 1024;
const MAX_FUTURE_CLOCK_SKEW_MS = 5_000;

export interface DesktopReceiverDiscoveryRecord {
  schemaVersion: 1;
  protocolVersion: typeof DESKTOP_RECEIVER_DISCOVERY_PROTOCOL;
  instanceId: string;
  pid: number;
  processIdentity: string;
  endpoint: string;
  sessionToken: string;
  updatedAt: string;
}

export interface DesktopReceiverDiscoveryHandle {
  instanceId: string;
  connection: DesktopReceiverConnection;
}

export type DesktopReceiverDiscoveryFailure =
  | 'unsupported'
  | 'missing'
  | 'invalid'
  | 'wrong-owner'
  | 'stale'
  | 'process-mismatch'
  | 'port-owner-mismatch';

export type DesktopReceiverDiscoveryResult =
  | { status: 'available'; connection: DesktopReceiverConnection }
  | { status: 'unavailable'; reason: DesktopReceiverDiscoveryFailure };

export interface DesktopDiscoverySecurity {
  secureDirectory(directory: string): Promise<void>;
  secureFile(file: string): Promise<void>;
  isCurrentUserOwner(file: string): Promise<boolean>;
  listeningProcessId(endpoint: string): Promise<number | null>;
}

export interface WindowsDesktopReceiverDiscoveryOptions {
  root?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pid?: number;
  maxAgeMs?: number;
  now?: () => number;
  readIdentity?: (pid: number) => Promise<string | null>;
  inspectOwnership?: (pid: number, identity: string) => Promise<ProcessOwnership>;
  security?: DesktopDiscoverySecurity;
}

function powershellExecutable(environment: NodeJS.ProcessEnv): string {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function powershell(
  environment: NodeJS.ProcessEnv,
  script: string,
  arguments_: readonly string[],
): Promise<string> {
  const argumentEnvironment = Object.fromEntries(
    arguments_.map((argument, index) => [`REPOCTOPUS_PS_ARG_${index}`, argument]),
  );
  const result = await execute(
    powershellExecutable(environment),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `& { $ErrorActionPreference='Stop'; ${script} }`,
    ],
    {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024,
      env: { ...environment, ...argumentEnvironment },
    },
  );
  return result.stdout.trim();
}

function windowsSecurity(environment: NodeJS.ProcessEnv): DesktopDiscoverySecurity {
  const secure = async (target: string, directory: boolean): Promise<void> => {
    const accessor = directory ? 'Directory' : 'File';
    const inheritance = directory ? 'ContainerInherit,ObjectInherit' : 'None';
    await powershell(
      environment,
      `$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $target=$env:REPOCTOPUS_PS_ARG_0; $acl=[System.IO.${accessor}]::GetAccessControl($target); $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($identity.User); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User,'FullControl','${inheritance}','None','Allow'); $acl.SetAccessRule($rule); [System.IO.${accessor}]::SetAccessControl($target,$acl)`,
      [target],
    );
  };
  return {
    secureDirectory: (directory) => secure(directory, true),
    secureFile: (file) => secure(file, false),
    async isCurrentUserOwner(file) {
      const result = await powershell(
        environment,
        `$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent(); $target=$env:REPOCTOPUS_PS_ARG_0; $acl=[System.IO.File]::GetAccessControl($target,[System.Security.AccessControl.AccessControlSections]::Owner); $ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]); if($ownerSid.Value -eq $identity.User.Value){'owned'}else{'other'}`,
        [file],
      );
      return result === 'owned';
    },
    async listeningProcessId(endpoint) {
      const url = new URL(endpoint);
      const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows';
      const result = await execute(
        path.join(systemRoot, 'System32', 'netstat.exe'),
        ['-ano', '-p', 'tcp'],
        {
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
          env: environment,
        },
      );
      const owners = new Set<number>();
      const localAddress = `127.0.0.1:${url.port}`;
      for (const line of result.stdout.split(/\r?\n/u)) {
        const fields = line.trim().split(/\s+/u);
        if (
          fields.length === 5 &&
          fields[0]?.toUpperCase() === 'TCP' &&
          fields[1] === localAddress &&
          fields[2] === '0.0.0.0:0' &&
          /^\d+$/u.test(fields[4] ?? '')
        ) {
          owners.add(Number(fields[4]));
        }
      }
      return owners.size === 1 ? [...owners][0]! : null;
    },
  };
}

function discoveryRoot(environment: NodeJS.ProcessEnv): string {
  const localAppData = environment.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData)) {
    throw new Error('LOCALAPPDATA is required for Windows Desktop discovery');
  }
  return path.join(localAppData, 'Repoctopus');
}

function isLoopbackEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    const port = Number(endpoint.port);
    return (
      endpoint.protocol === 'http:' &&
      endpoint.hostname === '127.0.0.1' &&
      endpoint.pathname === '/' &&
      endpoint.search === '' &&
      endpoint.hash === '' &&
      Number.isSafeInteger(port) &&
      port > 0 &&
      port <= 65_535
    );
  } catch {
    return false;
  }
}

function parseRecord(value: unknown): DesktopReceiverDiscoveryRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.join(',') !==
    [
      'endpoint',
      'instanceId',
      'pid',
      'processIdentity',
      'protocolVersion',
      'schemaVersion',
      'sessionToken',
      'updatedAt',
    ].join(',')
  )
    return null;
  if (
    record.schemaVersion !== 1 ||
    record.protocolVersion !== DESKTOP_RECEIVER_DISCOVERY_PROTOCOL ||
    typeof record.instanceId !== 'string' ||
    !/^[0-9a-f-]{36}$/u.test(record.instanceId) ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.processIdentity !== 'string' ||
    record.processIdentity.length < 4 ||
    record.processIdentity.length > 512 ||
    typeof record.endpoint !== 'string' ||
    !isLoopbackEndpoint(record.endpoint) ||
    typeof record.sessionToken !== 'string' ||
    record.sessionToken.length < 32 ||
    record.sessionToken.length > 512 ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  )
    return null;
  return record as unknown as DesktopReceiverDiscoveryRecord;
}

export class WindowsDesktopReceiverDiscovery {
  readonly #platform: NodeJS.Platform;
  readonly #pid: number;
  readonly #root: string;
  readonly #file: string;
  readonly #maxAgeMs: number;
  readonly #now: () => number;
  readonly #readIdentity: (pid: number) => Promise<string | null>;
  readonly #inspectOwnership: (pid: number, identity: string) => Promise<ProcessOwnership>;
  readonly #security: DesktopDiscoverySecurity;

  constructor(options: WindowsDesktopReceiverDiscoveryOptions = {}) {
    const environment = options.environment ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#pid = options.pid ?? process.pid;
    this.#root = path.resolve(
      options.root ?? environment.REPOCTOPUS_DESKTOP_DISCOVERY_ROOT ?? discoveryRoot(environment),
    );
    this.#file = path.join(this.#root, 'desktop-receiver.json');
    this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_DESKTOP_DISCOVERY_MAX_AGE_MS;
    if (!Number.isSafeInteger(this.#maxAgeMs) || this.#maxAgeMs <= 0) {
      throw new Error('Desktop discovery max age must be a positive safe integer');
    }
    this.#now = options.now ?? Date.now;
    this.#readIdentity = options.readIdentity ?? readProcessIdentity;
    this.#inspectOwnership = options.inspectOwnership ?? inspectProcessOwnership;
    this.#security = options.security ?? windowsSecurity(environment);
  }

  get file(): string {
    return this.#file;
  }

  async publish(connection: DesktopReceiverConnection): Promise<DesktopReceiverDiscoveryHandle> {
    if (this.#platform !== 'win32')
      throw new Error('Desktop discovery is supported on Windows only');
    if (!isLoopbackEndpoint(connection.endpoint) || connection.sessionToken.length < 32) {
      throw new Error('Desktop receiver connection is invalid');
    }
    const processIdentity = await this.#readIdentity(this.#pid);
    if (processIdentity === null) {
      throw new Error('Desktop Host process identity is unavailable');
    }
    const handle = { instanceId: randomUUID(), connection: { ...connection } };
    await fs.mkdir(this.#root, { recursive: true });
    await this.#security.secureDirectory(this.#root);
    await this.#write(handle, processIdentity);
    return handle;
  }

  async refresh(handle: DesktopReceiverDiscoveryHandle): Promise<void> {
    const current = await this.#readOwnedRecord();
    if (current === null || current.instanceId !== handle.instanceId) {
      throw new Error('Desktop discovery ownership changed');
    }
    await this.#write(handle, current.processIdentity);
  }

  async remove(handle: DesktopReceiverDiscoveryHandle): Promise<void> {
    const current = await this.#readOwnedRecord();
    if (current === null || current.instanceId !== handle.instanceId) return;
    await fs.unlink(this.#file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async discover(): Promise<DesktopReceiverDiscoveryResult> {
    if (this.#platform !== 'win32') return { status: 'unavailable', reason: 'unsupported' };
    let ownerChecks = 0;
    try {
      const result = await readFileRaceSafe(this.#file, MAX_DISCOVERY_BYTES, {
        label: 'Desktop receiver discovery',
        verify: async (checkpoint) => {
          if (checkpoint === 'post-open') return;
          ownerChecks += 1;
          if (!(await this.#security.isCurrentUserOwner(this.#file))) {
            throw new Error('wrong-owner');
          }
        },
      });
      if (ownerChecks !== 2) return { status: 'unavailable', reason: 'invalid' };
      const record = parseRecord(JSON.parse(result.bytes.toString('utf8')));
      if (record === null) return { status: 'unavailable', reason: 'invalid' };
      const updatedAt = Date.parse(record.updatedAt);
      const age = this.#now() - updatedAt;
      if (age > this.#maxAgeMs || age < -MAX_FUTURE_CLOCK_SKEW_MS) {
        return { status: 'unavailable', reason: 'stale' };
      }
      if ((await this.#inspectOwnership(record.pid, record.processIdentity)) !== 'matched') {
        return { status: 'unavailable', reason: 'process-mismatch' };
      }
      if ((await this.#security.listeningProcessId(record.endpoint)) !== record.pid) {
        return { status: 'unavailable', reason: 'port-owner-mismatch' };
      }
      return {
        status: 'available',
        connection: {
          schemaVersion: 1,
          endpoint: record.endpoint,
          sessionToken: record.sessionToken,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'unavailable', reason: 'missing' };
      }
      if (error instanceof Error && error.message === 'wrong-owner') {
        return { status: 'unavailable', reason: 'wrong-owner' };
      }
      return { status: 'unavailable', reason: 'invalid' };
    }
  }

  async #readOwnedRecord(): Promise<DesktopReceiverDiscoveryRecord | null> {
    const discovered = await readFileRaceSafe(this.#file, MAX_DISCOVERY_BYTES, {
      label: 'Desktop receiver discovery',
      verify: async (checkpoint) => {
        if (checkpoint !== 'post-open' && !(await this.#security.isCurrentUserOwner(this.#file))) {
          throw new Error('Desktop discovery owner changed');
        }
      },
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (discovered === null) return null;
    try {
      return parseRecord(JSON.parse(discovered.bytes.toString('utf8')));
    } catch {
      return null;
    }
  }

  async #write(handle: DesktopReceiverDiscoveryHandle, processIdentity: string): Promise<void> {
    const record: DesktopReceiverDiscoveryRecord = {
      schemaVersion: 1,
      protocolVersion: DESKTOP_RECEIVER_DISCOVERY_PROTOCOL,
      instanceId: handle.instanceId,
      pid: this.#pid,
      processIdentity,
      endpoint: handle.connection.endpoint,
      sessionToken: handle.connection.sessionToken,
      updatedAt: new Date(this.#now()).toISOString(),
    };
    await atomicWriteJson(this.#file, record, { containedRoot: this.#root });
    await this.#security.secureFile(this.#file);
  }
}
