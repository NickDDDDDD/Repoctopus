import type { Context } from '@deepseek-ai/cordis';

import { FileEventInboxStore } from '../../platform/events/file-event-inbox-store.js';
import { PlatformEvents } from '../../services/platform-events.js';

export interface FilePlatformEventsConfig {
  workspaceRoot: string;
}

export class FilePlatformEventsProvider extends PlatformEvents {
  protected readonly inbox: FileEventInboxStore;

  constructor(context: Context, config: FilePlatformEventsConfig) {
    super(context);
    this.inbox = new FileEventInboxStore(config.workspaceRoot);
  }
}
