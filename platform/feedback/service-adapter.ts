import type { ChildProcess } from 'node:child_process';
import net from 'node:net';

import type {
  AttachedServiceRequest,
  ManagedServiceRequest,
  ManagedServiceRecovery,
  ManagedServiceSession,
  ReadinessCondition,
  ReadinessProbe,
  ServiceAdapter,
  ServiceLogs,
  ServiceObservation,
} from '../../domains/feedback/service.js';
import { inspectProcessLiveness, readProcessIdentity } from '../process/process-identity.js';
import { spawnCommand } from '../process/spawn-command.js';
import {
  terminateProcessTree,
  terminateRecoveredProcessTree,
} from '../process/terminate-process-tree.js';
import type { ResourceLease } from '../runtime/resource-lease.js';
import { FileResourceLeaseManager } from '../runtime/resource-lease.js';
import { BoundedTextCapture } from './bounded-text-capture.js';
import { DEFAULT_COMMAND_OUTPUT_BYTES } from './command-adapter.js';
import {
  managedCommandDigest,
  ManagedServiceRegistry,
  type ManagedServiceRegistration,
} from './managed-service-registry.js';

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readJsonPath(value: unknown, jsonPath: string): unknown {
  return jsonPath
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, value);
}

async function tcpReady(host: string, port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean, detail: string): void => {
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (error) => finish(false, error.message));
  });
}

async function httpReady(
  condition: Extract<ReadinessCondition, { type: 'http' }>,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(condition.url, { signal: AbortSignal.timeout(1000) });
    const statuses = condition.statusCodes ?? [200];
    if (!statuses.includes(response.status)) {
      return { ok: false, detail: `status ${response.status}` };
    }
    if (condition.jsonPath) {
      const body = await response.json();
      const actual = readJsonPath(body, condition.jsonPath);
      if (!Object.is(actual, condition.equals)) {
        return { ok: false, detail: `json ${condition.jsonPath} did not match` };
      }
    }
    return { ok: true, detail: `status ${response.status}` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

async function probe(condition: ReadinessCondition, logs: ServiceLogs): Promise<ReadinessProbe> {
  const timestamp = new Date().toISOString();
  if (condition.type === 'tcp') {
    const result = await tcpReady(condition.host, condition.port);
    return {
      type: 'tcp',
      target: `${condition.host}:${condition.port}`,
      timestamp,
      ...result,
    };
  }
  if (condition.type === 'http') {
    const result = await httpReady(condition);
    return { type: 'http', target: condition.url, timestamp, ...result };
  }
  try {
    const expression = new RegExp(condition.pattern, 'u');
    const source =
      condition.stream === 'stderr'
        ? logs.stderr
        : condition.stream === 'stdout'
          ? logs.stdout
          : `${logs.stdout}\n${logs.stderr}`;
    const ok = expression.test(source);
    return {
      type: 'log',
      target: condition.pattern,
      timestamp,
      ok,
      detail: ok ? 'matched' : 'not matched',
    };
  } catch (error) {
    return {
      type: 'log',
      target: condition.pattern,
      timestamp,
      ok: false,
      detail: `invalid regular expression: ${(error as Error).message}`,
    };
  }
}

async function waitForConditions(input: {
  conditions: readonly ReadinessCondition[];
  logs: () => ServiceLogs;
  exited: () => boolean;
  timeoutMs: number;
  intervalMs: number;
}): Promise<{ status: 'ready' | 'failed' | 'timed_out'; probes: ReadinessProbe[] }> {
  const deadline = Date.now() + input.timeoutMs;
  const probes: ReadinessProbe[] = [];
  while (true) {
    const current = await Promise.all(
      input.conditions.map((condition) => probe(condition, input.logs())),
    );
    probes.push(...current);
    if (current.every((item) => item.ok)) return { status: 'ready', probes };
    if (input.exited()) return { status: 'failed', probes };
    if (Date.now() >= deadline) return { status: 'timed_out', probes };
    await wait(input.intervalMs);
  }
}

class LocalManagedServiceSession implements ManagedServiceSession {
  readonly serviceId: string;
  private readonly stdout: BoundedTextCapture;
  private readonly stderr: BoundedTextCapture;
  private readonly probes: ReadinessProbe[] = [];
  private identity: string | null = null;
  private status: ServiceObservation['status'] = 'failed';
  private stopped = false;
  private processFailed = false;
  private processClosed = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly request: ManagedServiceRequest,
    private readonly leases: ResourceLease[],
    private readonly leaseManager: FileResourceLeaseManager,
    private readonly registration: ManagedServiceRegistration,
    private readonly registry: ManagedServiceRegistry,
  ) {
    this.serviceId = request.serviceId;
    this.identity = registration.processIdentity;
    this.stdout = new BoundedTextCapture(request.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES);
    this.stderr = new BoundedTextCapture(request.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.stdout.append(chunk));
    child.stderr?.on('data', (chunk: string) => this.stderr.append(chunk));
    child.once('error', () => {
      this.processFailed = true;
    });
    child.once('close', () => {
      this.processClosed = true;
    });
  }

  private async waitForProcessClose(timeoutMs = 5000): Promise<void> {
    if (this.processClosed) return;
    await new Promise<void>((resolve) => {
      const closed = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.child.removeListener('close', closed);
        this.child.stdin?.destroy();
        this.child.stdout?.destroy();
        this.child.stderr?.destroy();
        resolve();
      }, timeoutMs);
      this.child.once('close', closed);
    });
  }

  private logs(): ServiceLogs {
    const stdout = this.stdout.finish();
    const stderr = this.stderr.finish();
    return {
      stdout: stdout.contents,
      stderr: stderr.contents,
      stdoutBytes: stdout.bytesSeen,
      stderrBytes: stderr.bytesSeen,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  }

  snapshot(): ServiceObservation {
    return {
      serviceId: this.serviceId,
      mode: 'managed',
      trust: 'verified',
      status: this.status,
      probes: [...this.probes],
      logs: this.logs(),
      ...(this.child.pid
        ? {
            process: {
              pid: this.child.pid,
              ...(this.identity ? { identity: this.identity } : {}),
            },
          }
        : {}),
      ...(this.child.exitCode !== null ? { exitCode: this.child.exitCode } : {}),
    };
  }

  async waitUntilReady(): Promise<ServiceObservation> {
    const result = await waitForConditions({
      conditions: this.request.readiness,
      logs: () => this.logs(),
      exited: () =>
        this.processFailed || this.child.exitCode !== null || this.child.signalCode !== null,
      timeoutMs: this.request.startupTimeoutMs,
      intervalMs: this.request.probeIntervalMs ?? 100,
    });
    this.probes.push(...result.probes);
    this.status = result.status;
    return this.snapshot();
  }

  async stop(): Promise<ServiceObservation> {
    if (!this.stopped) {
      this.stopped = true;
      if (this.child.pid && this.child.exitCode === null && this.child.signalCode === null) {
        const liveness = await inspectProcessLiveness(this.child.pid, this.identity ?? undefined);
        if (liveness === 'alive' || liveness === 'unknown') {
          await terminateProcessTree(this.child);
        }
      }
      await this.waitForProcessClose();
      try {
        for (const lease of [...this.leases].reverse()) await this.leaseManager.release(lease);
      } finally {
        await this.registry.remove(this.registration);
      }
    }
    return this.snapshot();
  }
}

export class LocalServiceAdapter implements ServiceAdapter {
  private readonly leases: FileResourceLeaseManager;
  private readonly registry: ManagedServiceRegistry;

  constructor(workspace: string) {
    this.leases = new FileResourceLeaseManager(workspace);
    this.registry = new ManagedServiceRegistry(workspace);
  }

  async startManaged(request: ManagedServiceRequest): Promise<ManagedServiceSession> {
    const acquired: ResourceLease[] = [];
    let child: ChildProcess | undefined;
    let registration: ManagedServiceRegistration | undefined;
    try {
      const resources = new Set([`service:${request.serviceId}`, ...(request.resourceKeys ?? [])]);
      for (const resource of resources) {
        acquired.push(await this.leases.acquire(resource));
      }
      child = spawnCommand(request.executable, request.args, { cwd: request.cwd });
      if (!child.pid) throw new Error(`Managed service did not expose a pid: ${request.serviceId}`);
      const identity = await readProcessIdentity(child.pid);
      if (!identity) {
        throw new Error(`Managed service process identity is unavailable: ${request.serviceId}`);
      }
      for (let index = 0; index < acquired.length; index += 1) {
        acquired[index] = await this.leases.rebind(acquired[index]!, {
          pid: child.pid,
          processIdentity: identity,
        });
      }
      registration = this.registry.create({
        serviceId: request.serviceId,
        pid: child.pid,
        processIdentity: identity,
        startedAt: new Date().toISOString(),
        commandDigest: managedCommandDigest(request),
        processGroup: { strategy: 'pid-tree', id: child.pid },
        stopPolicy: 'owned-process-tree',
        leases: [...acquired],
        logArtifacts: [],
      });
      await this.registry.save(registration);
      return new LocalManagedServiceSession(
        child,
        request,
        acquired,
        this.leases,
        registration,
        this.registry,
      );
    } catch (error) {
      try {
        if (child) await terminateProcessTree(child);
      } finally {
        for (const lease of acquired.reverse()) await this.leases.release(lease);
        if (registration) await this.registry.remove(registration);
      }
      throw error;
    }
  }

  async recoverManaged(serviceId: string): Promise<ManagedServiceRecovery> {
    const registration = await this.registry.load(serviceId);
    if (!registration) {
      return {
        serviceId,
        status: 'not_found',
        diagnostic: 'No managed service registration exists',
      };
    }
    const process = { pid: registration.pid, identity: registration.processIdentity };
    const leasesMatch = await Promise.all(
      registration.leases.map((lease) => this.leases.isOwnedBy(lease)),
    );
    if (leasesMatch.some((matches) => !matches)) {
      return {
        serviceId,
        status: 'orphan',
        diagnostic: 'Managed service lease ownership could not be verified',
        process,
      };
    }
    const termination = await terminateRecoveredProcessTree(
      registration.pid,
      registration.processIdentity,
    );
    if (termination === 'identity_mismatch' || termination === 'unknown') {
      return {
        serviceId,
        status: 'orphan',
        diagnostic:
          termination === 'identity_mismatch'
            ? 'PID exists with a different creation identity'
            : 'Process identity could not be verified',
        process,
      };
    }
    for (const lease of [...registration.leases].reverse()) await this.leases.release(lease);
    await this.registry.remove(registration);
    return {
      serviceId,
      status: termination === 'not_running' ? 'already_stopped' : 'terminated',
      diagnostic:
        termination === 'not_running'
          ? 'Registered process was already stopped'
          : 'Recovered managed process tree was terminated',
      process,
    };
  }

  async observeAttached(request: AttachedServiceRequest): Promise<ServiceObservation> {
    const result = await waitForConditions({
      conditions: request.readiness,
      logs: () => ({
        stdout: '',
        stderr: '',
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
      exited: () => false,
      timeoutMs: request.startupTimeoutMs,
      intervalMs: request.probeIntervalMs ?? 100,
    });
    let buildIdentity: ServiceObservation['buildIdentity'];
    const identityRequest = request.buildIdentity;
    if (result.status === 'ready' && identityRequest) {
      const actual = await (async (): Promise<string | null> => {
        try {
          const response = await fetch(identityRequest.url, {
            signal: AbortSignal.timeout(1000),
          });
          const body = await response.json();
          const value = readJsonPath(body, identityRequest.jsonPath);
          return typeof value === 'string' ? value : null;
        } catch {
          return null;
        }
      })();
      buildIdentity = {
        expected: identityRequest.expected,
        actual,
        matched: actual === identityRequest.expected,
      };
    }
    return {
      serviceId: request.serviceId,
      mode: 'attached',
      trust: buildIdentity?.matched ? 'verified' : 'observed',
      status: result.status,
      probes: result.probes,
      logs: {
        stdout: '',
        stderr: '',
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
      ...(buildIdentity ? { buildIdentity } : {}),
    };
  }
}
