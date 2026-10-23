export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(
    event: 'second-instance',
    listener: (event: unknown, commandLine: string[]) => void,
  ): unknown;
}

/** Claim process-lifetime ownership before starting the Desktop Host. */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  focusOwner: (commandLine: readonly string[]) => void,
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit();
    return false;
  }
  application.on('second-instance', (_event, commandLine) => focusOwner(commandLine));
  return true;
}
