import { Service, type Context } from '@deepseek-ai/cordis';

export interface DesktopTelemetryEndpoint {
  origin: string;
  authorization: string;
}

export type DesktopTelemetrySignal = 'traces' | 'logs' | 'metrics';

export interface DesktopTelemetryDiagnostic {
  code:
    | 'unauthorized'
    | 'method-not-allowed'
    | 'unsupported-content-type'
    | 'invalid-json'
    | 'invalid-otlp-payload'
    | 'receiver-busy'
    | 'receiver-unavailable';
  signal: DesktopTelemetrySignal;
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
