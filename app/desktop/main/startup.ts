export interface DesktopReadyApplication {
  whenReady(): Promise<void>;
  exit(code: number): void;
}

/** Register startup with Electron's lifecycle instead of suspending the ESM entry module. */
export function scheduleDesktopStartup(
  application: DesktopReadyApplication,
  start: () => Promise<void>,
  reportFailure: (error: unknown) => void,
): void {
  void application
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      reportFailure(error);
      application.exit(1);
    });
}
