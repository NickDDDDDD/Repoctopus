export interface DesktopInstanceProbe {
  isAvailable(): Promise<boolean>;
}
