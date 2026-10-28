import type { DesktopClosePreference } from './shell-settings.js';
export type DesktopCloseDecision = Readonly<{
  action: 'cancel' | 'quit' | 'tray';
  remember: boolean;
}>;
export type DesktopQuitReason = 'application' | 'session' | 'tray' | 'window';
export interface DesktopShellLifecycleOptions {
  readPreference(): DesktopClosePreference;
  writePreference(preference: Exclude<DesktopClosePreference, 'ask'>): void;
  ask(): Promise<DesktopCloseDecision>;
  hideWindow(): void;
  showWindow(): void;
  stopBackend(): Promise<void>;
  quitApplication(): void;
  disposeTray(): void;
}
export class DesktopShellLifecycle {
  private closeDecision: Promise<void> | undefined;
  private shutdown: Promise<void> | undefined;
  private quitting = false;
  private quitReason: DesktopQuitReason | undefined;
  constructor(private readonly options: DesktopShellLifecycleOptions) {}
  get isQuitting() {
    return this.quitting;
  }
  get fullQuitReason(): DesktopQuitReason | undefined {
    return this.quitReason;
  }
  activateWindow(): void {
    if (!this.quitting) this.options.showWindow();
  }
  requestWindowClose(): Promise<void> {
    if (this.quitting) return this.shutdown ?? Promise.resolve();
    if (this.closeDecision) return this.closeDecision;
    const preference = this.options.readPreference();
    if (preference === 'tray') {
      this.options.hideWindow();
      return Promise.resolve();
    }
    if (preference === 'quit') return this.requestFullQuit('window');
    const pending = this.resolveAsk().finally(() => {
      if (this.closeDecision === pending) this.closeDecision = undefined;
    });
    this.closeDecision = pending;
    return pending;
  }
  requestFullQuit(reason: DesktopQuitReason): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.quitting = true;
    this.quitReason = reason;
    this.options.disposeTray();
    this.shutdown = this.options
      .stopBackend()
      .catch((error) => console.error('desktop backend shutdown failed', error))
      .finally(() => this.options.quitApplication());
    return this.shutdown;
  }
  private async resolveAsk(): Promise<void> {
    const decision = await this.options.ask();
    if (this.quitting || decision.action === 'cancel') return;
    if (decision.remember) this.options.writePreference(decision.action);
    if (decision.action === 'tray') this.options.hideWindow();
    else await this.requestFullQuit('window');
  }
}
