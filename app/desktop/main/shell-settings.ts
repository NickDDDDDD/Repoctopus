import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type DesktopClosePreference = 'ask' | 'quit' | 'tray';

export interface DesktopShellSettings {
  schemaVersion: 1;
  closePreference: DesktopClosePreference;
}

const DEFAULT_SETTINGS: DesktopShellSettings = {
  schemaVersion: 1,
  closePreference: 'ask',
};

function isClosePreference(value: unknown): value is DesktopClosePreference {
  return value === 'ask' || value === 'quit' || value === 'tray';
}

function parseSettings(raw: string): DesktopShellSettings {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Partial<DesktopShellSettings>).schemaVersion !== 1 ||
    !isClosePreference((value as Partial<DesktopShellSettings>).closePreference)
  ) {
    throw new Error('Desktop settings must contain schemaVersion 1 and a valid closePreference');
  }
  return {
    schemaVersion: 1,
    closePreference: (value as DesktopShellSettings).closePreference,
  };
}

/** Electron Shell-owned settings stored under userData, never under a Workspace. */
export class DesktopShellSettingsStore {
  readonly filePath: string;

  constructor(userData: string) {
    this.filePath = path.join(userData, 'desktop', 'settings.json');
  }

  read(): DesktopShellSettings {
    try {
      return parseSettings(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          'desktop settings: using safe defaults because settings could not be loaded',
          error,
        );
        return { ...DEFAULT_SETTINGS };
      }
      this.write(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
  }

  writeClosePreference(closePreference: DesktopClosePreference): void {
    if (!isClosePreference(closePreference)) {
      throw new Error('Desktop close preference is invalid');
    }
    this.write({ schemaVersion: 1, closePreference });
  }

  private write(settings: DesktopShellSettings): void {
    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${String(process.pid)}.tmp`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
