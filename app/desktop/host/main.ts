import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { bootDesktopComposition } from '../../boot/bootstrap.js';
import type { RunningApp } from '../../boot/boot.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
} from '../../../domains/telemetry/change-projection.js';
import { isDesktopShellCommand, type DesktopHostEvent } from '../shared/host-protocol.js';
import { DesktopOtlpHttpReceiver } from './otlp-http-receiver.js';
import { decodeOtlpJsonProjectionObservations } from './otlp-json-projection.js';

function send(event: DesktopHostEvent): void {
  if (process.connected) process.send?.(event);
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return message.slice(0, 64 * 1024);
}

let running: RunningApp | undefined;
let receiver: DesktopOtlpHttpReceiver | undefined;
let projection = createEmptyChangeProjection();
let shutdown: Promise<void> | undefined;

function close(): Promise<void> {
  if (shutdown !== undefined) return shutdown;
  shutdown = Promise.resolve()
    .then(async () => {
      await receiver?.stop();
      await running?.close();
      send({ type: 'shutdown-complete' });
      process.disconnect?.();
    })
    .catch((error: unknown) => {
      send({ type: 'fatal', message: failureMessage(error) });
      process.exitCode = 1;
    });
  return shutdown;
}

process.on('message', (message: unknown) => {
  if (isDesktopShellCommand(message)) void close();
});
process.once('disconnect', () => {
  void close();
});

const productRoot = path.resolve(process.argv[2] ?? process.cwd());

try {
  running = await bootDesktopComposition(productRoot);
  const sessionToken = randomBytes(32).toString('base64url');
  receiver = new DesktopOtlpHttpReceiver({
    sessionToken,
    onExport: (record) => {
      if (record.signal !== 'log' || record.contentType !== 'json') return;
      for (const observation of decodeOtlpJsonProjectionObservations(record.body)) {
        const reduced = reduceChangeProjection(projection, observation);
        projection = reduced.snapshot;
        if (reduced.delta) {
          send({ type: 'projection-updated', snapshot: projection, delta: reduced.delta });
        }
      }
    },
  });
  const endpoint = await receiver.start();
  send({
    type: 'ready',
    snapshot: running.context.desktopApplication.snapshot(),
    receiver: { schemaVersion: 1, endpoint, sessionToken },
    projection,
  });
} catch (error) {
  await receiver?.stop();
  await running?.close();
  send({ type: 'fatal', message: failureMessage(error) });
  process.exitCode = 1;
  process.disconnect?.();
}
