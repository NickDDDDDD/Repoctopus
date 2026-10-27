import path from 'node:path';

import { bootDesktopComposition } from '../../boot/bootstrap.js';
import type { RunningApp } from '../../boot/boot.js';
import {
  DEFAULT_DESKTOP_DISCOVERY_MAX_AGE_MS,
  WindowsDesktopReceiverDiscovery,
  type DesktopReceiverDiscoveryHandle,
} from '../../../platform/desktop/windows-receiver-discovery.js';
import { isDesktopShellCommand, type DesktopHostEvent } from '../shared/host-protocol.js';

function send(event: DesktopHostEvent): void {
  if (process.connected) process.send?.(event);
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return message.slice(0, 64 * 1024);
}

let running: RunningApp | undefined;
let unsubscribeProjection: (() => void) | undefined;
let shutdown: Promise<void> | undefined;
let discovery: WindowsDesktopReceiverDiscovery | undefined;
let discoveryHandle: DesktopReceiverDiscoveryHandle | undefined;
let discoveryRefresh: ReturnType<typeof setInterval> | undefined;

function close(): Promise<void> {
  if (shutdown !== undefined) return shutdown;
  shutdown = Promise.resolve()
    .then(async () => {
      if (discoveryRefresh !== undefined) clearInterval(discoveryRefresh);
      if (discovery !== undefined && discoveryHandle !== undefined) {
        await discovery.remove(discoveryHandle);
      }
      unsubscribeProjection?.();
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
  const receiver = running.context.desktopReceiver.connection();
  if (process.platform === 'win32') {
    discovery = new WindowsDesktopReceiverDiscovery();
    discoveryHandle = await discovery.publish(receiver);
    discoveryRefresh = setInterval(
      () => {
        if (discovery === undefined || discoveryHandle === undefined) return;
        void discovery.refresh(discoveryHandle).catch((error: unknown) => {
          send({ type: 'fatal', message: failureMessage(error) });
          void close();
        });
      },
      Math.floor(DEFAULT_DESKTOP_DISCOVERY_MAX_AGE_MS / 3),
    );
    discoveryRefresh.unref();
  }
  unsubscribeProjection = running.context.desktopProjection.subscribe((snapshot, delta) => {
    send({ type: 'projection-updated', snapshot, delta });
  });
  send({
    type: 'ready',
    snapshot: running.context.desktopApplication.snapshot(),
    receiver,
    projection: running.context.desktopProjection.snapshot(),
  });
} catch (error) {
  if (discoveryRefresh !== undefined) clearInterval(discoveryRefresh);
  if (discovery !== undefined && discoveryHandle !== undefined) {
    await discovery.remove(discoveryHandle);
  }
  unsubscribeProjection?.();
  await running?.close();
  send({ type: 'fatal', message: failureMessage(error) });
  process.exitCode = 1;
  process.disconnect?.();
}
