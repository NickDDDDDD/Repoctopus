import path from 'node:path';

import { bootDesktopComposition } from '../../boot/bootstrap.js';
import type { RunningApp } from '../../boot/boot.js';
import { isDesktopShellCommand, type DesktopHostEvent } from '../shared/host-protocol.js';

function send(event: DesktopHostEvent): void {
  if (process.connected) process.send?.(event);
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return message.slice(0, 64 * 1024);
}

let running: RunningApp | undefined;
let shutdown: Promise<void> | undefined;

function close(): Promise<void> {
  if (shutdown !== undefined) return shutdown;
  shutdown = Promise.resolve()
    .then(async () => {
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
  send({ type: 'ready', snapshot: running.context.desktopApplication.snapshot() });
} catch (error) {
  send({ type: 'fatal', message: failureMessage(error) });
  process.exitCode = 1;
  process.disconnect?.();
}
