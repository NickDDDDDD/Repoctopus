import path from 'node:path';

import { bootDesktopComposition } from '../../boot/bootstrap.js';
import type { RunningApp } from '../../boot/boot.js';
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  isDesktopShellCommand,
  type DesktopHostEvent,
} from '../shared/host-protocol.js';
import { ProjectionJournalStore } from './projection-journal-store.js';
import {
  DesktopReceiverDiscovery,
  type DesktopReceiverDiscoveryHandle,
} from './receiver-discovery.js';

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
let discovery: DesktopReceiverDiscovery | undefined;
let discoveryHandle: DesktopReceiverDiscoveryHandle | undefined;
let discoveryRefresh: ReturnType<typeof setInterval> | undefined;

function close(): Promise<void> {
  if (shutdown !== undefined) return shutdown;
  shutdown = Promise.resolve()
    .then(async () => {
      const failures: unknown[] = [];
      const settle = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          failures.push(error);
        }
      };
      if (discoveryRefresh !== undefined) clearInterval(discoveryRefresh);
      discoveryRefresh = undefined;
      const ownedDiscovery = discovery;
      const ownedDiscoveryHandle = discoveryHandle;
      if (ownedDiscovery !== undefined && ownedDiscoveryHandle !== undefined) {
        await settle(() => ownedDiscovery.remove(ownedDiscoveryHandle));
      }
      discoveryHandle = undefined;
      await settle(() => running?.context.desktopReceiver.stop() ?? Promise.resolve());
      await settle(() => running?.context.desktopProjection.closeJournal() ?? Promise.resolve());
      await settle(() => running?.close() ?? Promise.resolve());
      unsubscribeProjection?.();
      unsubscribeProjection = undefined;
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Desktop Host shutdown was incomplete');
      }
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
      process.disconnect?.();
    });
  return shutdown;
}

process.on('message', (message: unknown) => {
  if (!isDesktopShellCommand(message)) return;
  if (message.type === 'shutdown') {
    void close();
    return;
  }
  if (message.type === 'activate-context') {
    running?.context.desktopApplication.activate(message.context);
  } else {
    running?.context.desktopApplication.select(message.selection);
  }
  send({
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    type: 'snapshot-updated',
    snapshot: running?.context.desktopApplication.snapshot() ?? {
      apiVersion: 'repoctopus.desktop/v1alpha1',
      protocolVersion: 1,
      phase: 'ready',
      activeContext: message.type === 'activate-context' ? message.context : null,
      selectedContext: message.type === 'activate-context' ? message.context : message.selection,
    },
  });
});
process.once('disconnect', () => {
  void close();
});

const productRoot = path.resolve(process.argv[2] ?? process.cwd());

try {
  running = await bootDesktopComposition(productRoot);
  const dataRoot = process.env.REPOCTOPUS_DESKTOP_DATA_ROOT;
  if (dataRoot !== undefined) {
    const journal = await ProjectionJournalStore.open(
      path.join(path.resolve(dataRoot), 'projection'),
      running.context.desktopProjection.snapshot(),
    );
    await running.context.desktopProjection.attachJournal(journal);
  }
  const receiver = await running.context.desktopReceiver.start();
  const discoveryRoot = process.env.REPOCTOPUS_DESKTOP_DISCOVERY_ROOT;
  if (process.platform === 'win32' && discoveryRoot !== undefined) {
    discovery = new DesktopReceiverDiscovery({ root: discoveryRoot });
    discoveryHandle = await discovery.publish(receiver);
    discoveryRefresh = setInterval(() => {
      if (discovery === undefined || discoveryHandle === undefined) return;
      void discovery.refresh(discoveryHandle).catch((error: unknown) => {
        send({
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          type: 'fatal',
          message: failureMessage(error),
        });
        void close();
      });
    }, 15_000);
    discoveryRefresh.unref();
  }
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
