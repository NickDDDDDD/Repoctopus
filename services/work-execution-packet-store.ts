import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  WorkExecutionPacketStorePort,
  WorkExecutionPacketStoreSaveResult,
} from '../domains/work-execution/ports.js';
import type {
  WorkExecutionPacket,
  WorkExecutionPacketIdentity,
} from '../domains/work-execution/types.js';

export abstract class WorkExecutionPacketStore
  extends Service
  implements WorkExecutionPacketStorePort
{
  protected abstract readonly port: WorkExecutionPacketStorePort;

  constructor(context: Context) {
    super(context, 'workExecutionPacketStore');
  }

  save(packet: WorkExecutionPacket): Promise<WorkExecutionPacketStoreSaveResult> {
    return this.port.save(packet);
  }

  load(runId: string, identity: WorkExecutionPacketIdentity): Promise<WorkExecutionPacket> {
    return this.port.load(runId, identity);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workExecutionPacketStore: WorkExecutionPacketStore;
  }
}
