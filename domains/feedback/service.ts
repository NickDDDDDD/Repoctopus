export type ReadinessCondition =
  | { type: 'tcp'; host: string; port: number }
  | { type: 'http'; url: string; statusCodes?: number[]; jsonPath?: string; equals?: unknown }
  | { type: 'log'; pattern: string; stream?: 'stdout' | 'stderr' | 'combined' };

export interface ReadinessProbe {
  type: ReadinessCondition['type'];
  target: string;
  timestamp: string;
  ok: boolean;
  detail: string;
}

export interface ServiceLogs {
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface ManagedServiceRequest {
  serviceId: string;
  executable: string;
  args: readonly string[];
  cwd: string;
  readiness: readonly ReadinessCondition[];
  startupTimeoutMs: number;
  probeIntervalMs?: number;
  maxOutputBytes?: number;
  resourceKeys?: readonly string[];
}

export interface AttachedServiceRequest {
  serviceId: string;
  readiness: readonly ReadinessCondition[];
  startupTimeoutMs: number;
  probeIntervalMs?: number;
  buildIdentity?: { url: string; jsonPath: string; expected: string };
}

export interface ServiceObservation {
  serviceId: string;
  mode: 'managed' | 'attached';
  trust: 'verified' | 'observed';
  status: 'ready' | 'failed' | 'timed_out';
  probes: ReadinessProbe[];
  logs: ServiceLogs;
  process?: { pid: number; identity?: string };
  exitCode?: number;
  buildIdentity?: { expected: string; actual: string | null; matched: boolean };
}

export interface ManagedServiceSession {
  readonly serviceId: string;
  waitUntilReady(): Promise<ServiceObservation>;
  snapshot(): ServiceObservation;
  stop(): Promise<ServiceObservation>;
}

export interface ServiceAdapter {
  startManaged(request: ManagedServiceRequest): Promise<ManagedServiceSession>;
  observeAttached(request: AttachedServiceRequest): Promise<ServiceObservation>;
}
