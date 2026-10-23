import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mapObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import { WindowsDesktopLauncher } from '../platform/desktop/windows-launcher.js';
import { FileObservationEnvelopeStore } from '../platform/telemetry/observation-envelope-store.js';
import { ObservationOtlpJsonDestination } from '../platform/telemetry/observation-otlp-json.js';
import {
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const cleanupDirectories: string[] = [];
const cleanupProcesses: number[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupProcesses.splice(0).map(async (pid) => {
      try {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']);
      } catch {
        // The single-instance handoff process may already have exited.
      }
    }),
  );
  await Promise.all(cleanupDirectories.splice(0).map(removeTemporaryDirectory));
});

describe.runIf(process.platform === 'win32')('Desktop Launcher process boundary', () => {
  it('launches Electron, receives the private endpoint and replays a pending envelope', async () => {
    const workspace = await temporaryDirectory('repoctopus-desktop-launcher-');
    cleanupDirectories.push(workspace);
    const envelope = mapObservationEnvelope(
      {
        source: {
          domain: 'workflow',
          eventId: 'event-launcher-e2e',
          eventType: 'run.started',
          sequence: 1,
        },
        observedAt: new Date().toISOString(),
        attributes: {
          'repoctopus.workspace.id': 'launcher-workspace',
          'repoctopus.change.id': 'launcher-change',
          'repoctopus.change.status': 'active',
          'repoctopus.run.id': 'run-launcher-e2e',
          'repoctopus.run.status': 'active',
          'repoctopus.stage.name': 'implementation',
        },
      },
      {
        allowedAttributes: [
          'repoctopus.workspace.id',
          'repoctopus.change.id',
          'repoctopus.change.status',
          'repoctopus.run.id',
          'repoctopus.run.status',
          'repoctopus.stage.name',
        ],
        signals: [
          { kind: 'trace', name: 'repoctopus.run' },
          { kind: 'log', name: 'repoctopus.workflow.event', severity: 'info' },
          { kind: 'metric', name: 'repoctopus.workflow.events', value: 1, unit: 'event' },
        ],
      },
    );
    const store = new FileObservationEnvelopeStore(workspace);
    await store.save(envelope);
    const launcher = new WindowsDesktopLauncher({
      productRoot: repositoryRoot,
      workspaceRoot: repositoryRoot,
      timeoutMs: 20_000,
    });

    const activation = await launcher.activate({
      schemaVersion: 1,
      workspaceId: 'launcher-workspace',
      changeId: 'launcher-change',
      runId: 'run-launcher-e2e',
    });
    expect(activation.status).toBe('ready');
    if (activation.status !== 'ready') return;
    cleanupProcesses.push(activation.shellPid);
    const reactivated = await launcher.activate({
      schemaVersion: 1,
      workspaceId: 'launcher-workspace',
      changeId: 'launcher-change-two',
      runId: 'run-launcher-e2e-two',
    });
    expect(reactivated).toMatchObject({
      status: 'ready',
      shellPid: activation.shellPid,
      receiver: activation.receiver,
    });
    const pending = await store.pending('desktop-local');
    await new ObservationOtlpJsonDestination(activation.receiver).deliver(pending);
    for (const item of pending) await store.acknowledge('desktop-local', item);

    expect(await store.pending('desktop-local')).toEqual([]);
  }, 30_000);
});
