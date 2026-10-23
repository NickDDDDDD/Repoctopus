import { Service, type Context } from '@deepseek-ai/cordis';

export interface DesktopTelemetryEndpoint {
  origin: string;
  authorization: string;
}

export abstract class DesktopTelemetryReceiver extends Service {
  constructor(context: Context) {
    super(context, 'desktopTelemetryReceiver');
  }

  abstract ready(): Promise<void>;
  abstract endpoint(): DesktopTelemetryEndpoint;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopTelemetryReceiver: DesktopTelemetryReceiver;
  }
}
