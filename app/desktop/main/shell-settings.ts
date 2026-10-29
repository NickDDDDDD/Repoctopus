import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export type DesktopClosePreference = 'ask' | 'quit' | 'tray';
export interface DesktopShellSettings {
  schemaVersion: 1;
  closePreference: DesktopClosePreference;
}
const defaults: DesktopShellSettings = { schemaVersion: 1, closePreference: 'ask' };
function valid(value: unknown): value is DesktopClosePreference {
  return value === 'ask' || value === 'quit' || value === 'tray';
}
export class DesktopShellSettingsStore {
  readonly filePath: string;
  constructor(userData: string) {
    this.filePath = path.join(userData, 'desktop', 'settings.json');
  }
  read(): DesktopShellSettings {
    try {
      const value = JSON.parse(
        readFileSync(this.filePath, 'utf8'),
      ) as Partial<DesktopShellSettings>;
      if (value.schemaVersion !== 1 || !valid(value.closePreference))
        throw new Error('invalid settings');
      return { schemaVersion: 1, closePreference: value.closePreference };
    } catch {
      return { ...defaults };
    }
  }
  writeClosePreference(closePreference: DesktopClosePreference): void {
    if (!valid(closePreference)) throw new Error('Desktop close preference is invalid');
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, closePreference }) + '\n', {
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
