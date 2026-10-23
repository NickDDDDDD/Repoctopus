import { Service, type Context } from '@deepseek-ai/cordis';

import type { DesktopRunContext } from '../app/desktop/shared/activation-protocol.js';
import type { DesktopTelemetryEndpoint } from './desktop-telemetry-receiver.js';

export type DesktopActivationResult =
  | { status: 'ready'; shellPid: number; receiver: DesktopTelemetryEndpoint }
  | { status: 'unavailable'; diagnostic: string };

export interface DesktopReplayResult {
  delivered: number;
  pending: number;
}

export abstract class DesktopLauncher extends Service {
  constructor(context: Context) {
    super(context, 'desktopLauncher');
  }

  abstract activate(context: DesktopRunContext): Promise<DesktopActivationResult>;
}

export abstract class DesktopTelemetryDestination extends Service {
  constructor(context: Context) {
    super(context, 'desktopTelemetryDestination');
  }

  abstract replay(endpoint: DesktopTelemetryEndpoint): Promise<DesktopReplayResult>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopLauncher: DesktopLauncher;
    desktopTelemetryDestination: DesktopTelemetryDestination;
  }
}
