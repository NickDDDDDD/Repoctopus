import { Service, type Context } from '@deepseek-ai/cordis';

export const DESKTOP_APPLICATION_CONTRACT = 'repoctopus.desktop/v1alpha1' as const;

export interface DesktopApplicationSnapshot {
  apiVersion: typeof DESKTOP_APPLICATION_CONTRACT;
  phase: 'ready';
}

export class DesktopApplication extends Service {
  constructor(context: Context) {
    super(context, 'desktopApplication');
  }

  snapshot(): DesktopApplicationSnapshot {
    return {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      phase: 'ready',
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopApplication: DesktopApplication;
  }
}
