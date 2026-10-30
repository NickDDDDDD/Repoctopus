import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  WorkExecutionPacketStorePort,
  WorkExecutionPacketStoreSaveResult,
} from '../../domains/work-execution/ports.js';
import {
  restoreWorkExecutionPacket,
  type WorkExecutionPacket,
  type WorkExecutionPacketIdentity,
} from '../../domains/work-execution/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { assertRunId } from './paths.js';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function packetFile(
  workspaceRoot: string,
  runId: string,
  identity: WorkExecutionPacketIdentity,
): string {
  assertRunId(runId);
  if (
    identity.schemaVersion !== 1 ||
    !SHA256_DIGEST.test(identity.packetId) ||
    !SHA256_DIGEST.test(identity.packetDigest) ||
    !SHA256_DIGEST.test(identity.contextDigest)
  ) {
    throw new Error('Work execution packet identity is invalid');
  }
  return path.join(
    path.resolve(workspaceRoot),
    '.repoctopus',
    'runs',
    runId,
    'packets',
    `${identity.packetDigest.slice('sha256:'.length)}.json`,
  );
}

async function readPacket(file: string): Promise<WorkExecutionPacket> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as WorkExecutionPacket;
  return restoreWorkExecutionPacket(parsed);
}

export class FileWorkExecutionPacketStore implements WorkExecutionPacketStorePort {
  constructor(private readonly workspaceRoot: string) {}

  async save(packet: WorkExecutionPacket): Promise<WorkExecutionPacketStoreSaveResult> {
    const frozen = restoreWorkExecutionPacket(packet);
    const file = packetFile(this.workspaceRoot, frozen.claim.runId, frozen.identity);
    try {
      await atomicWriteJson(file, frozen, { exclusive: true });
      return { status: 'created', packet: frozen };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readPacket(file);
      if (canonicalJson(current) !== canonicalJson(frozen)) {
        throw new Error('Work execution packet content conflicts with its digest', {
          cause: error,
        });
      }
      return { status: 'reused', packet: current };
    }
  }

  async load(runId: string, identity: WorkExecutionPacketIdentity): Promise<WorkExecutionPacket> {
    const packet = await readPacket(packetFile(this.workspaceRoot, runId, identity));
    if (
      packet.claim.runId !== runId ||
      canonicalJson(packet.identity) !== canonicalJson(identity)
    ) {
      throw new Error('Stored Work execution packet does not match the requested identity');
    }
    return packet;
  }
}
