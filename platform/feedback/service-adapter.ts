import type { ChildProcess } from 'node:child_process';
import net from 'node:net';

import type {
  AttachedServiceRequest,
  ManagedServiceRequest,
  ManagedServiceSession,
  ReadinessCondition,
  ReadinessProbe,
  ServiceAdapter,
  ServiceLogs,
  ServiceObservation,
} from '../../domains/feedback/service.js';
import { inspectProcessLiveness, readProcessIdentity } from '../process/process-identity.js';
import { spawnCommand } from '../process/spawn-command.js';
import { terminateProcessTree } from '../process/terminate-process-tree.js';
import type { ResourceLease } from '../runtime/resource-lease.js';
import { FileResourceLeaseManager } from '../runtime/resource-lease.js';
import { BoundedTextCapture } from './bounded-text-capture.js';
import { DEFAULT_COMMAND_OUTPUT_BYTES } from './command-adapter.js';

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

  constructor(
    private readonly child: ChildProcess,
    private readonly request: ManagedServiceRequest,
    private readonly leases: ResourceLease[],
    private readonly leaseManager: FileResourceLeaseManager,
  ) {
    this.serviceId = request.serviceId;
    this.stdout = new BoundedTextCapture(request.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES);
    this.stderr = new BoundedTextCapture(request.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.stdout.append(chunk));
    child.stderr?.on('data', (chunk: string) => this.stderr.append(chunk));
    child.once('error', () => {
      this.processFailed = true;
    });
  }

  async initializeIdentity(): Promise<void> {
    this.identity = this.child.pid ? await readProcessIdentity(this.child.pid) : null;
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
      for (const lease of [...this.leases].reverse()) await this.leaseManager.release(lease);
    }
    return this.snapshot();
  }
}

export class LocalServiceAdapter implements ServiceAdapter {
  private readonly leases: FileResourceLeaseManager;

  constructor(workspace: string) {
    this.leases = new FileResourceLeaseManager(workspace);
  }

  async startManaged(request: ManagedServiceRequest): Promise<ManagedServiceSession> {
    const acquired: ResourceLease[] = [];
    try {
      for (const resource of request.resourceKeys ?? []) {
        acquired.push(await this.leases.acquire(resource));
      }
      const child = spawnCommand(request.executable, request.args, { cwd: request.cwd });
      const session = new LocalManagedServiceSession(child, request, acquired, this.leases);
      await session.initializeIdentity();
      return session;
    } catch (error) {
      for (const lease of acquired.reverse()) await this.leases.release(lease);
      throw error;
    }
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
