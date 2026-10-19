import type { Context } from '@deepseek-ai/cordis';

import type { ActionStorePort } from '../../domains/action/ports.js';
import { FileActionStore } from '../../platform/action/file-action-store.js';
import { ActionStore } from '../../services/action.js';

export interface FileActionStoreConfig {
  workspaceRoot: string;
}

export class FileActionStoreProvider extends ActionStore {
  protected readonly port: ActionStorePort;

  constructor(context: Context, config: FileActionStoreConfig) {
    super(context);
    this.port = new FileActionStore(config.workspaceRoot);
  }
}
