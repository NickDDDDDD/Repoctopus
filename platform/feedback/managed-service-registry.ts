import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteJson } from '../filesystem/atomic-write.js';
import type { ResourceLease } from '../runtime/resource-lease.js';

export interface ManagedServiceRegistration {
  schemaVersion: 1;
  registrationId: string;
  serviceId: string;
  pid: number;
  processIdentity: string;
  startedAt: string;
  commandDigest: string;
  processGroup: { strategy: 'pid-tree'; id: number };
  stopPolicy: 'owned-process-tree';
  leases: ResourceLease[];
  logArtifacts: string[];
}

function assertRegistration(value: unknown, file: string): ManagedServiceRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid managed service registration: ${file}`);
  }
  const candidate = value as Partial<ManagedServiceRegistration>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.registrationId !== 'string' ||
    typeof candidate.serviceId !== 'string' ||
    !Number.isSafeInteger(candidate.pid) ||
    typeof candidate.processIdentity !== 'string' ||
    typeof candidate.startedAt !== 'string' ||
    typeof candidate.commandDigest !== 'string' ||
    candidate.stopPolicy !== 'owned-process-tree' ||
    !Array.isArray(candidate.leases) ||
    !Array.isArray(candidate.logArtifacts) ||
    candidate.processGroup?.strategy !== 'pid-tree' ||
    !Number.isSafeInteger(candidate.processGroup.id)
  ) {
    throw new Error(`Invalid managed service registration: ${file}`);
  }
  return candidate as ManagedServiceRegistration;
}

export function managedCommandDigest(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([input.executable, [...input.args], input.cwd]))
    .digest('hex');
}

export class ManagedServiceRegistry {
  constructor(private readonly workspace: string) {}

  private file(serviceId: string): string {
    const digest = createHash('sha256').update(serviceId).digest('hex');
    return path.join(this.workspace, '.repoctopus', 'runtime', 'services', `${digest}.json`);
  }

  create(
    input: Omit<ManagedServiceRegistration, 'schemaVersion' | 'registrationId'>,
  ): ManagedServiceRegistration {
    return { schemaVersion: 1, registrationId: randomUUID(), ...input };
  }

  async save(registration: ManagedServiceRegistration): Promise<void> {
    const file = this.file(registration.serviceId);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWriteJson(file, registration);
  }

  async load(serviceId: string): Promise<ManagedServiceRegistration | null> {
    const file = this.file(serviceId);
    try {
      const bytes = await readFile(file);
      if (bytes.byteLength > 1024 * 1024) {
        throw new Error(`Managed service registration is too large: ${file}`);
      }
      return assertRegistration(JSON.parse(bytes.toString('utf8')) as unknown, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(registration: ManagedServiceRegistration): Promise<void> {
    const current = await this.load(registration.serviceId);
    if (!current) return;
    if (current.registrationId !== registration.registrationId) {
      throw new Error(`Managed service registration changed: ${registration.serviceId}`);
    }
    await rm(this.file(registration.serviceId), { force: true });
  }
}
