import path from 'node:path';

import { bootDesktopComposition } from '../../boot/bootstrap.js';
import type { RunningApp } from '../../boot/boot.js';
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  isDesktopShellCommand,
  type DesktopHostEvent,
} from '../shared/host-protocol.js';

function send(event: DesktopHostEvent): void {
  if (process.connected) process.send?.(event);
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return message.slice(0, 64 * 1024);
}

let running: RunningApp | undefined;
let shutdown: Promise<void> | undefined;
let unsubscribeProjection: (() => void) | undefined;

function close(): Promise<void> {
  if (shutdown !== undefined) return shutdown;
  shutdown = Promise.resolve()
    .then(async () => {
      await running?.close();
      unsubscribeProjection?.();
      unsubscribeProjection = undefined;
      send({ protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, type: 'shutdown-complete' });
      process.disconnect?.();
    })
    .catch((error: unknown) => {
      send({
        protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        type: 'fatal',
        message: failureMessage(error),
      });
      process.exitCode = 1;
    });
  return shutdown;
}

process.on('message', (message: unknown) => {
  if (!isDesktopShellCommand(message)) return;
  if (message.type === 'shutdown') {
    void close();
    return;
  }
  running?.context.desktopApplication.activate(message.context);
  send({
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    type: 'snapshot-updated',
    snapshot: running?.context.desktopApplication.snapshot() ?? {
      apiVersion: 'repoctopus.desktop/v1alpha1',
      protocolVersion: 1,
      phase: 'ready',
      activeContext: message.context,
    },
  });
});
process.once('disconnect', () => {
  void close();
});

const productRoot = path.resolve(process.argv[2] ?? process.cwd());

try {
  running = await bootDesktopComposition(productRoot);
  const receiver = await running.context.desktopReceiver.start();
  unsubscribeProjection = running.context.desktopProjection.subscribe((snapshot, delta) => {
    send({
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      type: 'projection-updated',
      snapshot,
      delta,
    });
  });
  send({
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    type: 'ready',
    snapshot: running.context.desktopApplication.snapshot(),
    receiver,
    projection: running.context.desktopProjection.snapshot(),
  });
} catch (error) {
  send({
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    type: 'fatal',
    message: failureMessage(error),
  });
  process.exitCode = 1;
  process.disconnect?.();
}
