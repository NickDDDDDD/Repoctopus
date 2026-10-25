import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import type {
  WorkExecutionHost,
  WorkExecutionHostIdentity,
  WorkExecutionPacket,
  WorkExecutionSessionIdentity,
} from '../domains/work-execution/types.js';

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export interface WorkExecutionHostSnapshot {
  schemaVersion: 1;
  hosts: readonly WorkExecutionHostIdentity[];
  digest: `sha256:${string}`;
}

export class WorkExecutionHosts extends Service {
  private readonly hosts = new Map<string, WorkExecutionHost>();

  constructor(context: Context) {
    super(context, 'workExecutionHosts');
  }

  register(host: WorkExecutionHost): () => void {
    const id = host.identity.id.trim();
    if (!id) throw new Error('Work Execution Host id is required');
    if (this.hosts.has(id)) throw new Error(`Work Execution Host already registered: ${id}`);
    this.hosts.set(id, host);
    return () => {
      if (this.hosts.get(id) === host) this.hosts.delete(id);
    };
  }

  select(packet: WorkExecutionPacket): WorkExecutionHost {
    const candidates = [...this.hosts.values()].filter(
      (host) =>
        host.identity.actionKinds.includes(packet.hostRequirement.actionKind) &&
        packet.hostRequirement.capabilities.every((capability) =>
          host.identity.capabilities.includes(capability),
        ),
    );
    if (candidates.length !== 1) {
      throw new Error(
        candidates.length === 0
          ? `No Work Execution Host supports ${packet.work.kind}`
          : `Work Execution Host selection is ambiguous for ${packet.work.kind}: ${candidates
              .map((host) => host.identity.id)
              .sort()
              .join(', ')}`,
      );
    }
    return candidates[0]!;
  }

  snapshot(): WorkExecutionHostSnapshot {
    const hosts = [...this.hosts.values()]
      .map((host) => structuredClone(host.identity))
      .sort((left, right) => left.id.localeCompare(right.id));
    return { schemaVersion: 1, hosts, digest: sha256(canonicalJson(hosts)) };
  }
}

interface ActiveSession {
  identity: WorkExecutionSessionIdentity;
  hostId: string;
  active: boolean;
}

export class WorkExecutionSessions extends Service {
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(context: Context) {
    super(context, 'workExecutionSessions');
  }

  open(input: {
    runId: string;
    workId: string;
    attempt: number;
    invocationId: string;
    packetDigest: `sha256:${string}`;
    hostId: string;
  }): WorkExecutionSessionIdentity {
    const nonce = randomUUID();
    const identity: WorkExecutionSessionIdentity = {
      schemaVersion: 1,
      sessionId: sha256(
        `${input.runId}\0${input.workId}\0${input.attempt}\0${input.invocationId}\0${input.packetDigest}\0${nonce}`,
      ),
      runId: input.runId,
      workId: input.workId,
      attempt: input.attempt,
      invocationId: input.invocationId,
      packetDigest: input.packetDigest,
    };
    this.sessions.set(identity.sessionId, {
      identity,
      hostId: input.hostId,
      active: true,
    });
    return structuredClone(identity);
  }

  require(identity: WorkExecutionSessionIdentity, hostId?: string): WorkExecutionSessionIdentity {
    const session = this.sessions.get(identity.sessionId);
    if (
      !session?.active ||
      canonicalJson(session.identity) !== canonicalJson(identity) ||
      (hostId !== undefined && session.hostId !== hostId)
    ) {
      throw new Error('Work Execution Session is missing, expired, or belongs to another Host');
    }
    return structuredClone(session.identity);
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.active = false;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workExecutionHosts: WorkExecutionHosts;
    workExecutionSessions: WorkExecutionSessions;
  }
}
