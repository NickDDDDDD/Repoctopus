import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Context, Plugin } from '@deepseek-ai/cordis';
import { afterEach, expect, it } from 'vitest';

import { bootApp } from '../app/boot/boot.js';
import { compileComposition } from '../app/boot/composition.js';
import { createBuiltinCatalog, PLUGIN_CONTRACT_VERSION } from '../app/boot/descriptor.js';
import { deliveryEnvelope } from '../domains/platform-events/inbox.js';
import { FileEventInboxStore } from '../platform/events/file-event-inbox-store.js';
import {
  PlatformEvents,
  type PlatformEventClaimInput,
  type PlatformEventProcessor,
} from '../services/platform-events.js';
import { createRepoctopusBuiltinCatalog } from '../plugins/builtin-catalog.js';
import type { PlatformEventRunnerConfig } from '../services/platform-event-runner.js';

const roots: string[] = [];
const claimGates = new Map<string, { claimed: () => void; release: Promise<void> }>();

class DelayedFilePlatformEventsProvider extends PlatformEvents {
  protected readonly inbox: FileEventInboxStore;
  private readonly gateId: string;

  constructor(context: Context, config: { workspaceRoot: string; gateId: string }) {
    super(context);
    this.inbox = new FileEventInboxStore(config.workspaceRoot);
    this.gateId = config.gateId;
  }

  override async claimDue(input: PlatformEventClaimInput) {
    const entry = await super.claimDue(input);
    const gate = claimGates.get(this.gateId);
    if (entry && gate) {
      gate.claimed();
      await gate.release;
    }
    return entry;
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-event-runner-'));
  roots.push(root);
  return root;
}

async function bootPlatformEvents(root: string) {
  const productRoot = path.resolve(import.meta.dirname, '..');
  const catalog = await createRepoctopusBuiltinCatalog(productRoot);
  const composition = compileComposition(
    {
      id: 'platform-events-test',
      kind: 'project',
      plugins: [{ id: 'platform-events-file', config: { workspaceRoot: root } }],
      requiredServices: ['platformEvents'],
    },
    catalog,
  );
  return bootApp({ composition, catalog });
}

async function bootRunner(
  root: string,
  processor: PlatformEventProcessor,
  config: Partial<PlatformEventRunnerConfig> = {},
  options: { claimGateId?: string } = {},
) {
  const productRoot = path.resolve(import.meta.dirname, '..');
  const builtin = await createRepoctopusBuiltinCatalog(productRoot);
  const contributor = Object.assign(
    ((context: Context) => {
      context.effect(() => context.platformEvents.register(processor));
    }) as Plugin,
    { inject: ['platformEvents'] },
  );
  const catalog = createBuiltinCatalog([
    ...builtin.values(),
    ...(options.claimGateId
      ? [
          {
            descriptor: {
              id: 'delayed-platform-events-file',
              version: '1.0.0',
              contractVersion: PLUGIN_CONTRACT_VERSION,
              configSchemaVersion: '1',
              kind: 'service-provider' as const,
              source: 'builtin' as const,
              codeDigest: `sha256:${'e'.repeat(64)}` as const,
              compositions: ['project' as const],
              authorities: ['event-inbox-write'],
              permissions: ['filesystem' as const],
              stateSchemas: { 'event-inbox': '1' },
            },
            plugin: DelayedFilePlatformEventsProvider,
          },
        ]
      : []),
    {
      descriptor: {
        id: 'test-event-processor',
        version: '1.0.0',
        contractVersion: PLUGIN_CONTRACT_VERSION,
        configSchemaVersion: '1',
        kind: 'contributor',
        source: 'builtin',
        codeDigest: `sha256:${'f'.repeat(64)}`,
        compositions: ['project'],
        authorities: [],
        permissions: [],
        stateSchemas: {},
      },
      plugin: contributor,
    },
  ]);
  const composition = compileComposition(
    {
      id: 'platform-event-runner-test',
      kind: 'project',
      plugins: [
        options.claimGateId
          ? {
              id: 'delayed-platform-events-file',
              config: { workspaceRoot: root, gateId: options.claimGateId },
            }
          : { id: 'platform-events-file', config: { workspaceRoot: root } },
        { id: 'test-event-processor' },
        {
          id: 'platform-event-runner',
          config: {
            owner: 'test-runner',
            leaseMs: 1_000,
            pollIntervalMs: 60_000,
            retryDelayMs: 100,
            maxAttempts: 3,
            ...config,
          },
        },
      ],
      requiredServices: ['platformEventRunner', 'platformEvents'],
    },
    catalog,
  );
  return bootApp({ composition, catalog });
}

const receivedAt = '2026-10-20T00:00:00.000Z';
const envelope = deliveryEnvelope({
  provider: 'github',
  source: 'primary',
  deliveryId: 'delivery-runner-1',
  eventType: 'pull_request',
  receivedAt,
  payload: { number: 42 },
});

it('processes a duplicate delivery received out of order as one logical task', async () => {
  const root = await workspace();
  let tasks = 0;
  const app = await bootRunner(root, {
    id: 'logical-task-processor',
    provider: 'github',
    eventType: 'pull_request',
    process() {
      tasks += 1;
      return Promise.resolve({ result: 'completed' });
    },
  });
  await expect(app.context.platformEvents.accept(envelope, receivedAt)).resolves.toMatchObject({
    duplicate: false,
  });
  const olderDuplicate = deliveryEnvelope({
    ...envelope,
    receivedAt: '2026-10-19T23:59:00.000Z',
  });
  await expect(
    app.context.platformEvents.accept(olderDuplicate, '2026-10-20T00:00:01.000Z'),
  ).resolves.toMatchObject({ duplicate: true });

  await expect(
    app.context.platformEventRunner.runOnce(() => new Date(receivedAt)),
  ).resolves.toEqual({ processed: 1 });
  await expect(
    app.context.platformEventRunner.runOnce(() => new Date(receivedAt)),
  ).resolves.toEqual({ processed: 0 });
  expect(tasks).toBe(1);
  await app.close();
});

it('persists accept, lease, and completion through the PlatformEvents service across restart', async () => {
  const root = await workspace();
  const first = await bootPlatformEvents(root);
  expect(await first.context.platformEvents.accept(envelope, receivedAt)).toEqual({
    duplicate: false,
    envelopeId: envelope.envelopeId,
  });
  const claimed = await first.context.platformEvents.claimDue({
    owner: 'runner-a',
    timestamp: receivedAt,
    leaseMs: 1_000,
  });
  expect(claimed).toMatchObject({
    status: 'leased',
    attempts: 1,
    lease: { owner: 'runner-a' },
  });
  await first.context.platformEvents.settle({
    envelopeId: envelope.envelopeId,
    leaseToken: claimed!.lease!.token,
    timestamp: '2026-10-20T00:00:00.100Z',
    result: 'completed',
  });
  await first.close();

  const restarted = await bootPlatformEvents(root);
  await expect(restarted.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'completed',
    attempts: 1,
  });
  await expect(
    restarted.context.platformEvents.receipts(envelope.envelopeId),
  ).resolves.toMatchObject([{ result: 'completed', attempt: 1 }]);
  await restarted.close();
});

it('claims and completes a pending delivery through the Runner public service', async () => {
  const root = await workspace();
  const processor: PlatformEventProcessor = {
    id: 'test-pull-request',
    provider: 'github',
    eventType: 'pull_request',
    process(input) {
      expect(input.envelope.payload).toEqual({ number: 42 });
      return Promise.resolve({ result: 'completed' });
    },
  };
  const app = await bootRunner(root, processor, { owner: 'runner-a' });
  await app.context.platformEvents.accept(envelope, receivedAt);

  expect(await app.context.platformEventRunner.runOnce(() => new Date(receivedAt))).toMatchObject({
    processed: 1,
  });
  await expect(app.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'completed',
    attempts: 1,
  });
  await app.close();
});

it('persists retry waiting and does not reclaim the delivery before it is due', async () => {
  const root = await workspace();
  const app = await bootRunner(
    root,
    {
      id: 'retry-once',
      provider: 'github',
      eventType: 'pull_request',
      process({ attempt }) {
        return Promise.resolve(attempt === 1 ? { result: 'retry' } : { result: 'completed' });
      },
    },
    {
      owner: 'runner-retry',
    },
  );
  await app.context.platformEvents.accept(envelope, receivedAt);

  await expect(
    app.context.platformEventRunner.runOnce(() => new Date(receivedAt)),
  ).resolves.toEqual({ processed: 1 });
  await expect(app.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'retry_wait',
    attempts: 1,
    nextAttemptAt: '2026-10-20T00:00:00.100Z',
  });
  await expect(
    app.context.platformEventRunner.runOnce(() => new Date('2026-10-20T00:00:00.099Z')),
  ).resolves.toEqual({ processed: 0 });
  await expect(
    app.context.platformEventRunner.runOnce(() => new Date('2026-10-20T00:00:00.100Z')),
  ).resolves.toEqual({ processed: 1 });
  await expect(app.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'completed',
    attempts: 2,
  });
  await expect(app.context.platformEvents.receipts(envelope.envelopeId)).resolves.toMatchObject([
    { result: 'retry', attempt: 1 },
    { result: 'completed', attempt: 2 },
  ]);
  await app.close();
});

it('schedules retry from processing completion rather than lease acquisition', async () => {
  const root = await workspace();
  const retryDelayMs = 10_000;
  const app = await bootRunner(
    root,
    {
      id: 'delayed-retry',
      provider: 'github',
      eventType: 'pull_request',
      async process() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { result: 'retry' };
      },
    },
    { retryDelayMs },
  );
  await app.context.platformEvents.accept(envelope, receivedAt);
  const startedAt = Date.now();

  await app.context.platformEventRunner.runOnce();

  const entry = (await app.context.platformEvents.load(envelope.envelopeId))!;
  expect(Date.parse(entry.updatedAt)).toBeGreaterThanOrEqual(startedAt + 20);
  expect(Date.parse(entry.nextAttemptAt!) - Date.parse(entry.updatedAt)).toBe(retryDelayMs);
  await app.close();
});

it('renews its lease while a processor runs longer than the initial lease', async () => {
  const root = await workspace();
  const leaseMs = 1_000;
  let processed = 0;
  const app = await bootRunner(
    root,
    {
      id: 'slow-processor',
      provider: 'github',
      eventType: 'pull_request',
      async process() {
        processed += 1;
        await new Promise((resolve) => setTimeout(resolve, leaseMs + 500));
        return { result: 'completed' };
      },
    },
    { leaseMs },
  );
  await app.context.platformEvents.accept(envelope, new Date().toISOString());

  await expect(app.context.platformEventRunner.runOnce()).resolves.toEqual({ processed: 1 });
  expect(processed).toBe(1);
  await expect(app.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'completed',
    attempts: 1,
  });
  await app.close();
});

it('dead-letters a repeatedly failing processor at the configured attempt limit', async () => {
  const root = await workspace();
  const app = await bootRunner(
    root,
    {
      id: 'always-fails',
      provider: 'github',
      eventType: 'pull_request',
      process() {
        return Promise.reject(new Error('token=must-not-be-persisted'));
      },
    },
    {
      owner: 'runner-dead-letter',
      maxAttempts: 2,
    },
  );
  await app.context.platformEvents.accept(envelope, receivedAt);

  await app.context.platformEventRunner.runOnce(() => new Date(receivedAt));
  await app.context.platformEventRunner.runOnce(() => new Date('2026-10-20T00:00:00.100Z'));

  await expect(app.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'dead_letter',
    attempts: 2,
    diagnostic: 'platform-event-attempt-limit-exceeded',
  });
  const receipts = await app.context.platformEvents.receipts(envelope.envelopeId);
  expect(receipts).toMatchObject([
    { result: 'retry', attempt: 1, diagnostic: 'platform-event-processing-failed' },
    { result: 'dead_letter', attempt: 2, diagnostic: 'platform-event-attempt-limit-exceeded' },
  ]);
  expect(JSON.stringify(receipts)).not.toContain('must-not-be-persisted');
  await app.close();
});

it('redacts free-form processor diagnostics before they reach durable state', async () => {
  const root = await workspace();
  const app = await bootRunner(root, {
    id: 'unsafe-diagnostic',
    provider: 'github',
    eventType: 'pull_request',
    process() {
      return Promise.resolve({ result: 'retry', diagnostic: 'token=must-not-be-persisted' });
    },
  });
  await app.context.platformEvents.accept(envelope, receivedAt);

  await app.context.platformEventRunner.runOnce(() => new Date(receivedAt));

  await expect(app.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'retry_wait',
    diagnostic: 'platform-event-processor-diagnostic-redacted',
  });
  const receipts = await app.context.platformEvents.receipts(envelope.envelopeId);
  expect(JSON.stringify(receipts)).not.toContain('must-not-be-persisted');
  await app.close();
});

it('reclaims an expired lease after Runner restart without processing it early', async () => {
  const root = await workspace();
  const first = await bootPlatformEvents(root);
  await first.context.platformEvents.accept(envelope, receivedAt);
  await first.context.platformEvents.claimDue({
    owner: 'crashed-runner',
    timestamp: receivedAt,
    leaseMs: 1_000,
  });
  await first.close();

  const restarted = await bootRunner(
    root,
    {
      id: 'recovered-processor',
      provider: 'github',
      eventType: 'pull_request',
      process() {
        return Promise.resolve({ result: 'completed' });
      },
    },
    {
      owner: 'restarted-runner',
    },
  );

  await expect(
    restarted.context.platformEventRunner.runOnce(() => new Date('2026-10-20T00:00:00.999Z')),
  ).resolves.toEqual({ processed: 0 });
  await expect(
    restarted.context.platformEventRunner.runOnce(() => new Date('2026-10-20T00:00:01.000Z')),
  ).resolves.toEqual({ processed: 1 });
  await expect(restarted.context.platformEvents.load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'completed',
    attempts: 2,
  });
  await restarted.close();
});

it('starts from its timer and drains an active durable operation before unload', async () => {
  const root = await workspace();
  let entered!: () => void;
  let release!: () => void;
  const processing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const processorEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const app = await bootRunner(
    root,
    {
      id: 'blocking-processor',
      provider: 'github',
      eventType: 'pull_request',
      async process() {
        entered();
        await processing;
        return { result: 'completed' };
      },
    },
    {
      owner: 'runner-drain',
      pollIntervalMs: 5,
      shutdownTimeoutMs: 500,
    },
  );
  await app.context.platformEvents.accept(envelope, receivedAt);
  await processorEntered;

  let closed = false;
  const closing = app.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(closed).toBe(false);
  release();
  await closing;

  await expect(new FileEventInboxStore(root).load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'completed',
    attempts: 1,
  });
});

it('stops renewing after drain timeout so a replacement Runner can recover', async () => {
  const root = await workspace();
  const leaseMs = 1_000;
  let entered!: () => void;
  const processorEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const app = await bootRunner(
    root,
    {
      id: 'hung-processor',
      provider: 'github',
      eventType: 'pull_request',
      process() {
        calls += 1;
        if (calls === 1) {
          entered();
          return new Promise(() => undefined);
        }
        return Promise.resolve({ result: 'completed' });
      },
    },
    { leaseMs, shutdownTimeoutMs: 20 },
  );
  await app.context.platformEvents.accept(envelope, new Date().toISOString());
  void app.context.platformEventRunner.runOnce();
  await processorEntered;

  const loaderEntries = app.composition.entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.config === undefined ? {} : { config: entry.config }),
  }));
  await app.context.loader.root.update(
    loaderEntries.filter((entry) => entry.id !== 'platform-event-runner'),
  );
  await app.context.loader.await();
  const leaseAfterDispose = (await app.context.platformEvents.load(envelope.envelopeId))!.lease!;
  await new Promise((resolve) => setTimeout(resolve, leaseMs + 250));
  const expiredLease = (await app.context.platformEvents.load(envelope.envelopeId))!.lease!;
  expect(expiredLease.expiresAt).toBe(leaseAfterDispose.expiresAt);

  await app.context.loader.root.update(loaderEntries);
  await app.context.loader.await();
  await expect(app.context.platformEventRunner.runOnce()).resolves.toEqual({ processed: 1 });
  expect(calls).toBe(2);
  await app.close();
});

it('does not process a lease committed while the Runner is unloading', async () => {
  const root = await workspace();
  const gateId = 'claim-during-unload';
  let claimed!: () => void;
  let release!: () => void;
  const claimCommitted = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const releaseClaim = new Promise<void>((resolve) => {
    release = resolve;
  });
  claimGates.set(gateId, { claimed, release: releaseClaim });
  let processed = 0;
  const app = await bootRunner(
    root,
    {
      id: 'unload-race-processor',
      provider: 'github',
      eventType: 'pull_request',
      process() {
        processed += 1;
        return Promise.resolve({ result: 'completed' });
      },
    },
    { owner: 'runner-unload-race', shutdownTimeoutMs: 500 },
    { claimGateId: gateId },
  );
  await app.context.platformEvents.accept(envelope, receivedAt);
  const running = app.context.platformEventRunner.runOnce(() => new Date(receivedAt));
  await claimCommitted;

  const closing = app.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await Promise.all([running, closing]);
  claimGates.delete(gateId);

  expect(processed).toBe(0);
  await expect(new FileEventInboxStore(root).load(envelope.envelopeId)).resolves.toMatchObject({
    status: 'leased',
    attempts: 1,
  });

  const restarted = await bootRunner(root, {
    id: 'unload-race-recovery',
    provider: 'github',
    eventType: 'pull_request',
    process() {
      processed += 1;
      return Promise.resolve({ result: 'completed' });
    },
  });
  await expect(
    restarted.context.platformEventRunner.runOnce(() => new Date('2026-10-20T00:00:01.000Z')),
  ).resolves.toEqual({ processed: 1 });
  expect(processed).toBe(1);
  await restarted.close();
});
