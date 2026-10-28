import { Service, type Context } from '@deepseek-ai/cordis';

import {
  parseDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../app/desktop/shared/launch-context.js';

export const DESKTOP_APPLICATION_CONTRACT = 'repoctopus.desktop/v1alpha1' as const;

export interface DesktopApplicationSnapshot {
  apiVersion: typeof DESKTOP_APPLICATION_CONTRACT;
  protocolVersion: 1;
  phase: 'ready';
  activeContext: DesktopLaunchContext | null;
  selectedContext: DesktopLaunchContext | null;
}

export class DesktopApplication extends Service {
  private activeContext: DesktopLaunchContext | null = null;
  private selectedContext: DesktopLaunchContext | null = null;

  constructor(context: Context) {
    super(context, 'desktopApplication');
  }

  snapshot(): DesktopApplicationSnapshot {
    return {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      protocolVersion: 1,
      phase: 'ready',
      activeContext: this.activeContext === null ? null : structuredClone(this.activeContext),
      selectedContext: this.selectedContext === null ? null : structuredClone(this.selectedContext),
    };
  }

  activate(context: DesktopLaunchContext): void {
    const next = parseDesktopLaunchContext(context);
    this.activeContext = next;
    this.selectedContext ??= next;
  }

  select(context: DesktopLaunchContext): void {
    this.selectedContext = parseDesktopLaunchContext(context);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopApplication: DesktopApplication;
  }
}
