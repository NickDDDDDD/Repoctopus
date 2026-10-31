import type { Context } from '@deepseek-ai/cordis';

import type { WorkExecutionPacketStorePort } from '../../domains/work-execution/ports.js';
import { FileWorkExecutionPacketStore } from '../../platform/runtime/file-work-execution-packet-store.js';
import { WorkExecutionPacketStore } from '../../services/work-execution-packet-store.js';

export interface FileWorkExecutionPacketStoreConfig {
  workspaceRoot: string;
}

export class FileWorkExecutionPacketStoreProvider extends WorkExecutionPacketStore {
  protected readonly port: WorkExecutionPacketStorePort;

  constructor(context: Context, config: FileWorkExecutionPacketStoreConfig) {
    super(context);
    this.port = new FileWorkExecutionPacketStore(config.workspaceRoot);
  }
}
