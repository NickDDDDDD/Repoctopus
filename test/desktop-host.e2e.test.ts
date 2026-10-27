import { execFile, fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { isDesktopHostEvent } from '../app/desktop/shared/host-protocol.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const productRoot = path.resolve(import.meta.dirname, '..');
const hostEntry = path.join(productRoot, 'dist', 'desktop', 'host.mjs');
const smokeEntry = path.join(productRoot, 'scripts', 'smoke-desktop.mjs');
const electronExecutable = require('electron') as string;

function nextMessage(child: ChildProcess): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
  });
}

describe('Desktop Host process', () => {
  it('boots the Cordis desktop composition and acknowledges graceful shutdown', async () => {
    const child = fork(hostEntry, [productRoot], {
      cwd: productRoot,
      silent: true,
    });
    try {
      const ready = await nextMessage(child);
      expect(isDesktopHostEvent(ready)).toBe(true);
      expect(ready).toMatchObject({
        type: 'ready',
        snapshot: { apiVersion: 'repoctopus.desktop/v1alpha1', phase: 'ready' },
      });

      if (!isDesktopHostEvent(ready) || ready.type !== 'ready') {
        throw new Error('Desktop Host did not publish a valid ready event');
      }
      expect(ready.receiver).toMatchObject({ schemaVersion: 1 });
      expect(ready.receiver.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(ready.receiver.sessionToken.length).toBeGreaterThanOrEqual(24);
      const exported = await fetch(`${ready.receiver.endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-protobuf',
          'x-repoctopus-session': ready.receiver.sessionToken,
        },
        body: new Uint8Array([10, 0]),
      });
      expect(exported.status).toBe(200);
      expect(await exported.text()).toBe('');

      const attribute = (key: string, value: string | number) => ({
        key,
        value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
      });
      const projectionMessage = nextMessage(child);
      const projected = await fetch(`${ready.receiver.endpoint}/v1/logs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-repoctopus-session': ready.receiver.sessionToken,
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              resource: {
                attributes: [attribute('repoctopus.workspace.id', 'workspace-e2e')],
              },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: '1793080800000000000',
                      body: { stringValue: 'change.phase.entered' },
                      attributes: [
                        attribute('repoctopus.event.id', 'event-e2e-open'),
                        attribute('repoctopus.event.sequence', 1),
                        attribute('repoctopus.change.id', 'desktop-e2e'),
                        attribute('repoctopus.run.id', 'run-desktop-e2e'),
                        attribute('repoctopus.workflow.name', 'repoctopus-change'),
                        attribute('repoctopus.execution.phase', 'open'),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });
      expect(projected.status).toBe(200);
      const update = await projectionMessage;
      expect(isDesktopHostEvent(update)).toBe(true);
      expect(update).toMatchObject({
        type: 'projection-updated',
        snapshot: {
          version: 1,
          activeChange: { workspaceId: 'workspace-e2e', changeId: 'desktop-e2e' },
          changes: [
            {
              changeId: 'desktop-e2e',
              runs: [{ runId: 'run-desktop-e2e', currentPhase: 'open' }],
            },
          ],
        },
        delta: { version: 1, eventId: 'event-e2e-open' },
      });

      const exited = new Promise<void>((resolve) => {
        child.once('close', () => resolve());
      });
      child.send({ type: 'shutdown' });
      const stopped = await nextMessage(child);
      expect(stopped).toEqual({ type: 'shutdown-complete' });
      await exited;
      expect(child.exitCode).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }, 20_000);

  it.runIf(process.platform === 'win32')(
    'renders the isolated desktop shell from a real Electron process',
    async () => {
      const profile = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-desktop-e2e-'));
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      try {
        await execFileAsync(electronExecutable, [`--user-data-dir=${profile}`, smokeEntry], {
          cwd: productRoot,
          env: environment,
          windowsHide: true,
          timeout: 25_000,
        });
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
