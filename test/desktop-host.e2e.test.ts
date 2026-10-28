import { execFile, fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { isDesktopHostEvent } from '../app/desktop/shared/host-protocol.js';
import { encodeObservationOtlpJson } from '../app/desktop/host/otlp-envelope-codec.js';
import type { ObservationEnvelope } from '../domains/trajectory/observation.js';

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
        protocolVersion: 1,
        snapshot: {
          apiVersion: 'repoctopus.desktop/v1alpha1',
          protocolVersion: 1,
          phase: 'ready',
          activeContext: null,
        },
        receiver: { schemaVersion: 1 },
        projection: { schemaVersion: 1, version: 0 },
      });

      const connection = (
        ready as {
          receiver: { endpoint: string; sessionToken: string };
        }
      ).receiver;
      const observation: ObservationEnvelope = {
        schemaVersion: 1,
        envelopeId: `sha256:${'1'.repeat(64)}`,
        digest: `sha256:${'2'.repeat(64)}`,
        observedAt: '2026-10-28T00:00:00.000Z',
        eventType: 'work.created',
        identity: { eventId: 'desktop-event-1', runId: 'desktop-run-1', sequence: 1 },
        correlation: {
          workspaceId: 'team-platform',
          changeId: 'desktop-dashboard',
          phase: 'build',
          buildAction: 'execute',
        },
        attributes: {},
      };
      const projectionUpdate = nextMessage(child);
      const accepted = await fetch(`${connection.endpoint}/v1/logs`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${connection.sessionToken}`,
          'content-type': 'application/json',
        },
        body: encodeObservationOtlpJson([observation], 'log'),
      });
      expect(accepted.status).toBe(200);
      expect(await projectionUpdate).toMatchObject({
        type: 'projection-updated',
        delta: { previousVersion: 0, version: 1, eventId: 'desktop-event-1' },
        snapshot: {
          version: 1,
          changes: [{ phase: 'build', buildAction: 'execute' }],
        },
      });

      const exited = new Promise<void>((resolve) => {
        child.once('close', () => resolve());
      });
      child.send({ protocolVersion: 1, type: 'shutdown' });
      const stopped = await nextMessage(child);
      expect(stopped).toEqual({ protocolVersion: 1, type: 'shutdown-complete' });
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
