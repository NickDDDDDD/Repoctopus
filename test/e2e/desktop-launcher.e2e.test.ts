import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';
import { WindowsDesktopProcessLauncher } from '../../platform/desktop/windows-desktop-process-launcher.js';
import { DesktopRunActivation } from '../../services/desktop-run-activation.js';
import { removeTemporaryDirectory, temporaryDirectory } from '../helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const context = {
  schemaVersion: 1 as const,
  workspaceId: 'team-platform',
  changeId: 'desktop-launcher-e2e',
  runId: 'change-desktop-launcher-e2e-1234',
};

const launchTarget = `
  import { writeFile } from 'node:fs/promises';
  const output = process.argv[1];
  const flag = process.argv.indexOf('--repoctopus-launch-context');
  if (!output || flag < 0 || !process.argv[flag + 1]) process.exit(2);
  const context = JSON.parse(Buffer.from(process.argv[flag + 1], 'base64url').toString('utf8'));
  await writeFile(output, JSON.stringify(context), 'utf8');
`;

async function waitForJson(file: string): Promise<unknown> {
  await vi.waitFor(
    async () => {
      await expect(readFile(file, 'utf8')).resolves.toBeTruthy();
    },
    { timeout: 5_000, interval: 20 },
  );
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

describe('Windows desktop launcher process boundary', () => {
  it('passes bounded Run context to a real desktop process and wakes replay', async () => {
    const root = await temporaryDirectory('repoctopus-desktop-launcher-');
    cleanup.push(root);
    const output = path.join(root, 'context.json');
    const wakeReplay = vi.fn(() => Promise.resolve());
    const activation = new DesktopRunActivation(
      new WindowsDesktopProcessLauncher({
        platform: 'win32',
        executable: process.execPath,
        prefixArguments: ['--input-type=module', '--eval', launchTarget, output],
      }),
      wakeReplay,
    );

    await expect(activation.beforeRun(context)).resolves.toEqual({
      status: 'ready',
      diagnostics: [],
    });
    await expect(waitForJson(output)).resolves.toEqual(context);
    expect(wakeReplay).toHaveBeenCalledWith(context);
  });

  it('keeps the same envelope deliverable to a remote destination when desktop launch fails', async () => {
    const received: Buffer[] = [];
    const remote = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push(Buffer.concat(chunks));
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve));
    try {
      const address = remote.address();
      if (!address || typeof address === 'string') throw new Error('remote mock did not bind');
      const envelope = createObservationEnvelope({
        source: {
          eventId: 'desktop-launch-failure-event',
          eventName: 'work.completed',
          observedAt: '2026-10-27T06:30:00.000Z',
        },
        correlation: { traceId: '1'.repeat(32), spanId: '2'.repeat(16) },
        resourceAttributes: { 'service.name': 'repoctopus' },
        recordAttributes: {
          'repoctopus.event.id': 'desktop-launch-failure-event',
          'repoctopus.execution.phase': 'open',
          'repoctopus.execution.work.kind': 'task.implement',
          'repoctopus.execution.result': 'succeeded',
        },
        metric: {
          value: 1,
          attributes: { phase: 'open', 'work.kind': 'task.implement', result: 'succeeded' },
        },
      });
      const encoded = Buffer.from(JSON.stringify(envelope));
      const activation = new DesktopRunActivation(
        new WindowsDesktopProcessLauncher({
          platform: 'win32',
          executable: path.join(process.cwd(), 'missing-dashboard.exe'),
        }),
        () => Promise.resolve(),
      );

      const desktop = await activation.beforeRun(context);
      const remoteResponse = await fetch(`http://127.0.0.1:${address.port}/v1/logs`, {
        method: 'POST',
        body: encoded,
      });

      expect(desktop).toMatchObject({
        status: 'warning',
        diagnostics: [{ code: 'desktop.launch-failed' }],
      });
      expect(remoteResponse.status).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(encoded);
      expect(JSON.parse(received[0]!.toString('utf8'))).toEqual(envelope);
    } finally {
      await new Promise<void>((resolve, reject) =>
        remote.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
