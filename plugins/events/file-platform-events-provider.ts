import type { Context } from '@deepseek-ai/cordis';

import { FileEventInboxStore } from '../../platform/events/file-event-inbox-store.js';
import { mapPlatformEventObservationEnvelope } from '../../platform/telemetry/observation-platform-event-mapping.js';
import { PlatformEvents } from '../../services/platform-events.js';

export interface FilePlatformEventsConfig {
  workspaceRoot: string;
}

export class FilePlatformEventsProvider extends PlatformEvents {
  protected readonly inbox: FileEventInboxStore;

  constructor(context: Context, config: FilePlatformEventsConfig) {
    super(context, {
      export: (event) => {
        const telemetry = context.get('observationTelemetry');
        return telemetry
          ? telemetry.publish([mapPlatformEventObservationEnvelope(event)])
          : Promise.resolve();
      },
    });
    this.inbox = new FileEventInboxStore(config.workspaceRoot);
  }
}
