import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Context } from '@deepseek-ai/cordis';
import { afterEach, expect, it } from 'vitest';

import { bootApp } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import { createBuiltinCatalog, PLUGIN_CONTRACT_VERSION } from '../app/boot/descriptor.js';
import { deliveryEnvelope } from '../domains/platform-events/inbox.js';
import type {
  PlatformEventTelemetryEvent,
  PlatformEventTelemetryPort,
} from '../domains/platform-events/ports.js';
import type {
  PlatformEventReplayResult,
  PlatformEventStatusView,
} from '../domains/platform-events/types.js';
import { FileEventInboxStore } from '../platform/events/file-event-inbox-store.js';
import { safePlatformEventAttributes } from '../platform/telemetry/platform-event-mapping.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import { PlatformEvents } from '../services/platform-events.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-event-management-'));
  roots.push(root);
  return root;
}

class CapturingTelemetry implements PlatformEventTelemetryPort {
  readonly events: PlatformEventTelemetryEvent[] = [];
  fail = false;

  export(event: PlatformEventTelemetryEvent): Promise<void> {
    if (this.fail) return Promise.reject(new Error('authorization=must-not-leak'));
    this.events.push(structuredClone(event));
    return Promise.resolve();
  }
}

async function bootManagement(root: string, telemetry = new CapturingTelemetry()) {
  class TestPlatformEventsProvider extends PlatformEvents {
    protected readonly inbox: FileEventInboxStore;

    constructor(context: Context, config: { workspaceRoot: string }) {
      super(context, telemetry);
      this.inbox = new FileEventInboxStore(config.workspaceRoot);
    }
  }

  const productRoot = path.resolve(import.meta.dirname, '..');
  const builtin = await createRepoctopusBuiltinCatalog(productRoot);
  const catalog = createBuiltinCatalog([
    ...builtin.values(),
    {
      descriptor: {
        id: 'test-platform-events',
        version: '1.0.0',
        contractVersion: PLUGIN_CONTRACT_VERSION,
        configSchemaVersion: '1',
        kind: 'service-provider',
        source: 'builtin',
        codeDigest: `sha256:${'a'.repeat(64)}`,
        compositions: ['project'],
        authorities: ['event-inbox-write'],
        permissions: ['filesystem'],
        stateSchemas: { 'event-inbox': '1' },
      },
      plugin: TestPlatformEventsProvider,
    },
  ]);
  const composition = compileComposition(
    {
      id: 'platform-event-management-test',
      kind: 'project',
      plugins: [
        { id: 'command-router' },
        { id: 'test-platform-events', config: { workspaceRoot: root } },
        { id: 'platform-event-command' },
      ],
      requiredServices: ['commandRouter', 'platformEvents'],
    },
    catalog,
  );
  return { app: await bootApp({ composition, catalog }), telemetry };
}

function sensitiveEnvelope(receivedAt = '2026-10-21T00:00:00.000Z') {
  return deliveryEnvelope({
    provider: 'github',
    source: 'primary',
    deliveryId: 'delivery-sensitive',
    eventType: 'pull_request',
    receivedAt,
    payload: {
      action: 'closed',
      authorization: 'Bearer ghp_must_not_leak_1234567890',
      headers: { cookie: 'session=must-not-leak' },
      body: 'raw-payload-must-not-leak',
      signature: 'sha256=must-not-leak',
    },
  });
}

it('replays canonical envelopes idempotently and returns only a sanitized status projection', async () => {
  const root = await workspace();
  const { app, telemetry } = await bootManagement(root);
  const envelope = sensitiveEnvelope();
  const first = await app.context.commandRouter.execute<
    { envelope: unknown; timestamp: string },
    PlatformEventReplayResult
  >('event.replay', { envelope, timestamp: '2026-10-21T00:00:01.000Z' });
  const outOfOrder = sensitiveEnvelope('2026-10-20T23:59:00.000Z');
  const duplicate = await app.context.commandRouter.execute<
    { envelope: unknown; timestamp: string },
    PlatformEventReplayResult
  >('event.replay', { envelope: outOfOrder, timestamp: '2026-10-21T00:00:02.000Z' });

  expect(first).toMatchObject({ duplicate: false, event: { status: 'pending', stateVersion: 0 } });
  expect(duplicate).toMatchObject({
    duplicate: true,
    event: { receivedAt: envelope.receivedAt, status: 'pending', stateVersion: 0 },
  });
  expect(telemetry.events.map((event) => event.type)).toEqual([
    'platform_event.accepted',
    'platform_event.deduplicated',
  ]);
  const serialized = JSON.stringify([first, duplicate, telemetry.events]);
  expect(serialized).not.toMatch(
    /ghp_|must-not-leak|raw-payload|authorization|cookie|headers|signature|"payload":/i,
  );
  await app.close();
});

it('manually retries only a dead letter and records an auditable retry receipt', async () => {
  const root = await workspace();
  const { app, telemetry } = await bootManagement(root);
  const envelope = sensitiveEnvelope();
  await app.context.platformEvents.accept(envelope, '2026-10-21T00:00:00.000Z');
  const claimed = await app.context.platformEvents.claimDue({
    owner: 'runner-a',
    timestamp: '2026-10-21T00:00:01.000Z',
    leaseMs: 1_000,
  });
  await app.context.platformEvents.settle({
    envelopeId: envelope.envelopeId,
    leaseToken: claimed!.lease!.token,
    timestamp: '2026-10-21T00:00:01.100Z',
    result: 'dead_letter',
    diagnostic: 'repository-not-mapped',
  });

  const retried = await app.context.commandRouter.execute<
    { envelopeId: string; timestamp: string },
    PlatformEventStatusView
  >('event.retry', {
    envelopeId: envelope.envelopeId,
    timestamp: '2026-10-21T00:00:02.000Z',
  });
  expect(retried).toMatchObject({
    status: 'retry_wait',
    attempts: 1,
    nextAttemptAt: '2026-10-21T00:00:02.000Z',
    diagnostic: 'manual-retry-requested',
    receipts: [
      { result: 'dead_letter', diagnostic: 'repository-not-mapped' },
      { result: 'retry', diagnostic: 'manual-retry-requested' },
    ],
  });
  await expect(
    app.context.platformEvents.retry(envelope.envelopeId, '2026-10-21T00:00:03.000Z'),
  ).rejects.toThrow('Only a dead-letter');
  const next = await app.context.platformEvents.claimDue({
    owner: 'runner-b',
    timestamp: '2026-10-21T00:00:02.000Z',
    leaseMs: 1_000,
  });
  expect(next).toMatchObject({ status: 'leased', attempts: 2, lease: { owner: 'runner-b' } });
  expect(telemetry.events.map((event) => event.type)).toEqual([
    'platform_event.accepted',
    'platform_event.claimed',
    'platform_event.dead_lettered',
    'platform_event.manual_retry_requested',
    'platform_event.claimed',
  ]);
  await app.close();
});

it('keeps durable Inbox facts when telemetry export fails', async () => {
  const root = await workspace();
  const telemetry = new CapturingTelemetry();
  telemetry.fail = true;
  const { app } = await bootManagement(root, telemetry);
  const envelope = sensitiveEnvelope();
  await expect(
    app.context.platformEvents.accept(envelope, '2026-10-21T00:00:00.000Z'),
  ).resolves.toMatchObject({ duplicate: false });
  await expect(app.context.platformEvents.status(envelope.envelopeId)).resolves.toMatchObject({
    status: 'pending',
  });
  await app.close();
});

it('rejects altered replay identities without echoing untrusted payload data', async () => {
  const root = await workspace();
  const { app } = await bootManagement(root);
  const envelope = { ...sensitiveEnvelope(), payloadDigest: `sha256:${'0'.repeat(64)}` };
  const failure = await app.context.platformEvents
    .replay(envelope)
    .catch((error: unknown) => error);
  expect(String(failure)).toBe('Error: Replay input must be a canonical PlatformDeliveryEnvelope');
  expect(String(failure)).not.toContain('must-not-leak');
  await app.close();
});

it('maps only allow-listed platform event fields to OpenTelemetry attributes', () => {
  const event = {
    schemaVersion: 1,
    type: 'platform_event.dead_lettered',
    timestamp: '2026-10-21T00:00:00.000Z',
    envelopeId: `sha256:${'a'.repeat(64)}`,
    provider: 'github',
    source: 'primary',
    deliveryId: 'delivery-1',
    eventType: 'pull_request',
    status: 'dead_letter',
    attempts: 3,
    stateVersion: 6,
    receiptId: `sha256:${'b'.repeat(64)}`,
    diagnostic: 'repository-not-mapped',
    payload: { authorization: 'Bearer ghp_must_not_leak_1234567890' },
    headers: { cookie: 'session=must-not-leak' },
  } as PlatformEventTelemetryEvent & Record<string, unknown>;
  const attributes = safePlatformEventAttributes(event);
  expect(attributes).toMatchObject({
    'repoctopus.platform_event.provider': 'github',
    'repoctopus.platform_event.status': 'dead_letter',
    'repoctopus.platform_event.diagnostic': 'repository-not-mapped',
  });
  expect(JSON.stringify(attributes)).not.toMatch(
    /ghp_|must-not-leak|authorization|cookie|payload/i,
  );
});
