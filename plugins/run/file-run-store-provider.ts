import type { Context } from '@deepseek-ai/cordis';

import type { RunStorePort } from '../../domains/runtime/types.js';
import { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import { RunStore } from '../../services/run-store.js';

export interface FileRunStoreConfig {
  workspaceRoot: string;
}

export class FileRunStoreProvider extends RunStore {
  protected readonly port: RunStorePort;

  constructor(context: Context, config: FileRunStoreConfig) {
    super(context);
    this.port = new FileRuntimeStore(config.workspaceRoot);
  }
}
