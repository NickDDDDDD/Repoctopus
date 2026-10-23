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
        snapshot: {
          apiVersion: 'repoctopus.desktop/v1alpha1',
          phase: 'ready',
          projection: { version: 0, freshness: 'empty' },
        },
      });
      if (!isDesktopHostEvent(ready) || ready.type !== 'ready') {
        throw new Error('Desktop Host did not provide a ready endpoint');
      }
      expect(ready.receiver.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(ready.receiver.authorization).toMatch(/^Bearer /u);

      const response = await fetch(new URL('/v1/logs', ready.receiver.origin), {
        method: 'POST',
        headers: {
          authorization: ready.receiver.authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    {
                      body: { stringValue: 'private body must not drive projection' },
                      attributes: [
                        { key: 'repoctopus.telemetry.schema.version', value: { intValue: '1' } },
                        {
                          key: 'repoctopus.envelope.id',
                          value: { stringValue: `sha256:${'a'.repeat(64)}` },
                        },
                        {
                          key: 'repoctopus.envelope.digest',
                          value: { stringValue: `sha256:${'b'.repeat(64)}` },
                        },
                        { key: 'repoctopus.stream.id', value: { stringValue: 'run-desktop-e2e' } },
                        { key: 'repoctopus.event.id', value: { stringValue: 'event-desktop-e2e' } },
                        { key: 'repoctopus.event.type', value: { stringValue: 'run.progressed' } },
                        { key: 'repoctopus.event.sequence', value: { intValue: '1' } },
                        {
                          key: 'repoctopus.observed_at',
                          value: { stringValue: new Date().toISOString() },
                        },
                        { key: 'repoctopus.workspace.id', value: { stringValue: 'workspace-e2e' } },
                        {
                          key: 'repoctopus.change.id',
                          value: { stringValue: 'desktop-dashboard-e2e' },
                        },
                        { key: 'repoctopus.change.status', value: { stringValue: 'active' } },
                        { key: 'repoctopus.run.id', value: { stringValue: 'run-desktop-e2e' } },
                        { key: 'repoctopus.run.status', value: { stringValue: 'active' } },
                        { key: 'repoctopus.stage.name', value: { stringValue: 'implementation' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });
      expect(response.status).toBe(200);
      const delta = await nextMessage(child);
      expect(isDesktopHostEvent(delta)).toBe(true);
      expect(delta).toMatchObject({
        type: 'projection.delta',
        delta: {
          baseVersion: 0,
          version: 1,
          projection: {
            change: { id: 'desktop-dashboard-e2e', status: 'active' },
            run: { id: 'run-desktop-e2e', status: 'active' },
            stage: { name: 'implementation', sequence: 1 },
          },
        },
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
