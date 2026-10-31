import type { WorkExecutionPacket, WorkExecutionPacketIdentity } from './types.js';

export interface WorkExecutionPacketStoreSaveResult {
  status: 'created' | 'reused';
  packet: WorkExecutionPacket;
}

export interface WorkExecutionPacketStorePort {
  save(packet: WorkExecutionPacket): Promise<WorkExecutionPacketStoreSaveResult>;
  load(runId: string, identity: WorkExecutionPacketIdentity): Promise<WorkExecutionPacket>;
}
