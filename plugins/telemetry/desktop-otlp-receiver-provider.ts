import type { Context } from '@deepseek-ai/cordis';

import {
  DesktopTelemetryReceiver,
  type DesktopTelemetryEndpoint,
} from '../../services/desktop-telemetry-receiver.js';
import { decodeDesktopOtlpBatch } from '../../platform/telemetry/desktop-otlp-decoder.js';
import {
  createDesktopOtlpSessionToken,
  DesktopOtlpReceiver,
} from '../../platform/telemetry/desktop-otlp-receiver.js';

export interface DesktopOtlpReceiverProviderConfig {
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
}

export class DesktopOtlpReceiverProvider extends DesktopTelemetryReceiver {
  static inject = ['desktopApplication'];

  private readonly receiver: DesktopOtlpReceiver;
  private readonly sessionToken = createDesktopOtlpSessionToken();

  constructor(context: Context, config: DesktopOtlpReceiverProviderConfig = {}) {
    super(context);
    this.receiver = new DesktopOtlpReceiver({
      sessionToken: this.sessionToken,
      ...(config.maxBodyBytes === undefined ? {} : { maxBodyBytes: config.maxBodyBytes }),
      ...(config.maxConcurrentRequests === undefined
        ? {}
        : { maxConcurrentRequests: config.maxConcurrentRequests }),
      accept: (batch) => {
        for (const record of decodeDesktopOtlpBatch(batch)) {
          context.desktopApplication.accept(record);
        }
      },
      diagnostic: (diagnostic) => {
        context.logger.warn(
          'Desktop OTLP request rejected: %s (%s)',
          diagnostic.code,
          diagnostic.signal,
        );
      },
    });
    context.effect(async () => {
      await this.receiver.ready();
      return async () => {
        await this.receiver.close();
      };
    }, 'repoctopus.desktop-otlp-receiver');
  }

  ready(): Promise<void> {
    return this.receiver.ready();
  }

  endpoint(): DesktopTelemetryEndpoint {
    return {
      origin: this.receiver.origin(),
      authorization: `Bearer ${this.sessionToken}`,
    };
  }
}
