import type { Context } from '@deepseek-ai/cordis';

import { FileEventInboxStore } from '../../platform/events/file-event-inbox-store.js';
import { platformEventTelemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/platform-event-exporter.js';
import { PlatformEvents } from '../../services/platform-events.js';

export interface FilePlatformEventsConfig {
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
}

export class FilePlatformEventsProvider extends PlatformEvents {
  protected readonly inbox: FileEventInboxStore;

  constructor(context: Context, config: FilePlatformEventsConfig) {
    super(context, platformEventTelemetryFromEnvironment(config.environment ?? process.env));
    this.inbox = new FileEventInboxStore(config.workspaceRoot);
  }
}
