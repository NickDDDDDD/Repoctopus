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

  /**
   * Lets the Desktop Application Fiber own ingress availability without taking
   * ownership of the Receiver Provider's native listener.
   */
  abstract acquireApplicationLease(): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopTelemetryReceiver: DesktopTelemetryReceiver;
  }
}
