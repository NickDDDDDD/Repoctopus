import { access } from 'node:fs/promises';
import path from 'node:path';

import type { BrowserSourceIdentity } from '../../domains/feedback/browser.js';
import { runExternalCommandAsync } from '../process/external-command.js';
import {
  doctorManagedChromium,
  readManagedChromiumMetadata,
  type ManagedBrowserDoctorResult,
} from './managed-browser.js';

export type BrowserSourceResolution =
  | { status: 'ready'; identity: BrowserSourceIdentity }
  | {
      status: 'incomplete';
      reason: string;
      installCommand?: ManagedBrowserDoctorResult['installCommand'];
    };

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function systemCandidates(): Array<{
  channel: 'chrome' | 'msedge';
  executablePath: string;
}> {
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value));
    return roots.flatMap((root) => [
      {
        channel: 'chrome' as const,
        executablePath: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      },
      {
        channel: 'msedge' as const,
        executablePath: path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      },
    ]);
  }
  if (process.platform === 'darwin') {
    return [
      {
        channel: 'chrome',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      },
      {
        channel: 'msedge',
        executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      },
    ];
  }
  return [
    { channel: 'chrome', executablePath: '/usr/bin/google-chrome' },
    { channel: 'chrome', executablePath: '/usr/bin/google-chrome-stable' },
    { channel: 'chrome', executablePath: '/usr/bin/chromium' },
    { channel: 'chrome', executablePath: '/usr/bin/chromium-browser' },
    { channel: 'msedge', executablePath: '/usr/bin/microsoft-edge' },
  ];
}

function channelForExecutable(executablePath: string): 'chrome' | 'msedge' {
  return path.basename(executablePath).toLowerCase().includes('edge') ? 'msedge' : 'chrome';
}

async function browserVersion(executablePath: string): Promise<string> {
  try {
    return (
      await runExternalCommandAsync(executablePath, ['--version'], {
        timeoutMs: 5000,
        maxBufferBytes: 4096,
      })
    ).trim();
  } catch {
    return 'unknown';
  }
}

export async function resolveBrowserSource(input: {
  workspace: string;
  source: 'managed' | 'system';
  configuredExecutablePath?: string;
}): Promise<BrowserSourceResolution> {
  const metadata = await readManagedChromiumMetadata();
  if (input.source === 'managed') {
    const doctor = await doctorManagedChromium(input.workspace);
    if (doctor.status !== 'ready' || !doctor.executablePath) {
      return {
        status: 'incomplete',
        reason: `Managed Chromium is ${doctor.status}; expected revision ${metadata.revision}`,
        installCommand: doctor.installCommand,
      };
    }
    return {
      status: 'ready',
      identity: {
        source: 'managed',
        trust: 'verified',
        channel: 'chromium',
        executablePath: doctor.executablePath,
        playwrightVersion: metadata.playwrightVersion,
        browserVersion: metadata.browserVersion,
        revision: metadata.revision,
      },
    };
  }

  const configured = input.configuredExecutablePath
    ? [
        {
          channel: channelForExecutable(input.configuredExecutablePath),
          executablePath: path.resolve(input.configuredExecutablePath),
        },
      ]
    : [];
  const candidates = [...configured, ...systemCandidates()];
  for (const candidate of candidates) {
    if (!(await exists(candidate.executablePath))) continue;
    return {
      status: 'ready',
      identity: {
        source: 'system',
        trust: 'observed',
        channel: candidate.channel,
        executablePath: candidate.executablePath,
        playwrightVersion: metadata.playwrightVersion,
        browserVersion: await browserVersion(candidate.executablePath),
      },
    };
  }
  return { status: 'incomplete', reason: 'No configured Chrome or Edge executable was found' };
}
