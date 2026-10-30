import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ActionIntent } from '../domains/action/types.js';
import type { WorkExecutionContext } from '../domains/change-lifecycle/work-context.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import {
  assertPacketIdentity,
  createWorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { FileWorkExecutionPacketStore } from '../platform/runtime/file-work-execution-packet-store.js';
import {
  compositionFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function fixture() {
  const context: WorkExecutionContext = {
    schemaVersion: 1,
    workId: 'build:1.1',
    digest: digest('d'),
    layers: [
      {
        kind: 'runtime-contract',
        priority: 1,
        source: 'repoctopus-runtime',
        content: 'Runtime owns transitions.',
        digest: digest('a'),
      },
      {
        kind: 'action-skill',
        priority: 2,
        source: 'repoctopus-build-task',
        content: 'Execute one approved task and report an Outcome.',
        digest: digest('b'),
      },
    ],
  };
  const work: WorkDescriptor = {
    schemaVersion: 2,
    workId: context.workId,
    checkEpoch: 4,
    phase: 'build',
    kind: 'task.implement',
    actionSkill: {
      schemaVersion: 1,
      name: 'repoctopus-build-task',
      provider: 'repoctopus-lifecycle',
      invocation: { modelInvocable: true, userInvocable: false },
      contentDigest: digest('b'),
      resourceManifestDigest: digest('c'),
    },
    augmentationSkills: [],
    methodProfile: {
      id: 'repoctopus.build',
      version: '1.0.0',
      digest: digest('e'),
      sourceDigests: [],
      ruleIds: [],
    },
    capabilities: ['repository.read', 'repository.write'],
    sideEffectClass: 'repository-write',
    writeScopes: [
      {
        repositoryId: 'workspace',
        paths: ['**'],
        operations: ['create', 'update', 'delete'],
      },
    ],
    inputDigest: digest('f'),
    outputContract: { artifactKinds: [], trackerPublish: false },
    validatorProfile: { id: 'build.task-valid', version: '1.0.0', digest: digest('1') },
    authorizationSource: {
      kind: 'lifecycle-definition',
      definitionId: 'repoctopus-change',
      definitionVersion: '2.0.0',
    },
    checkpoint: 'build.before-task',
  };
  const intent: ActionIntent = {
    schemaVersion: 3,
    intentId: 'intent-1',
    idempotencyKey: 'idempotency-1',
    runId: 'run-001',
    workId: work.workId,
    attempt: 1,
    checkEpoch: work.checkEpoch,
    claimToken: digest('2'),
    inputDigest: work.inputDigest,
    compositionDigest: compositionFixture().compositionDigest,
    composition: compositionFixture(),
    action: {
      id: work.workId,
      stepId: 'build:task.implement',
      type: 'invoke_skill',
      ref: 'repoctopus-build-task',
      summary: 'Execute task.implement',
    },
    adapter: 'process',
    executionContext: {
      digest: context.digest,
      layers: context.layers.map(({ kind, priority, source, digest: layerDigest }) => ({
        kind,
        priority,
        source,
        digest: layerDigest,
      })),
    },
    createdAt: '2026-10-25T00:00:00.000Z',
  };
  return { context, work, intent };
}

describe('WorkExecutionPacket', () => {
  it('binds full content to a stable identity and deep-freezes the packet', () => {
    const { intent, work, context } = fixture();
    const first = createWorkExecutionPacket({ intent, work, context });
    const second = createWorkExecutionPacket({
      intent: { ...intent, createdAt: '2026-10-25T01:00:00.000Z' },
      work,
      context,
    });

    expect(second.identity).toEqual(first.identity);
    expect(first.context.layers.map((layer) => layer.content)).toEqual([
      'Runtime owns transitions.',
      'Execute one approved task and report an Outcome.',
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.context)).toBe(true);
    expect(Object.isFrozen(first.context.layers[0])).toBe(true);
    expect(() => assertPacketIdentity(first)).not.toThrow();
  });

  it('changes identity when full context content changes', () => {
    const { intent, work, context } = fixture();
    const original = createWorkExecutionPacket({ intent, work, context });
    const changed = createWorkExecutionPacket({
      intent,
      work,
      context: {
        ...context,
        layers: context.layers.map((layer, index) =>
          index === 1 ? { ...layer, content: `${layer.content} Changed.` } : layer,
        ),
      },
    });
    expect(changed.identity.packetDigest).not.toBe(original.identity.packetDigest);
  });

  it('keeps sensitive context content outside the persisted intent identity', () => {
    const { intent, work, context } = fixture();
    const packet = createWorkExecutionPacket({ intent, work, context });
    expect(JSON.stringify(packet)).toContain('Runtime owns transitions.');
    expect(JSON.stringify(intent)).not.toContain('Runtime owns transitions.');
  });

  it('stores immutable packet content by Run and digest with idempotent concurrent saves', async () => {
    const root = await temporaryDirectory('repoctopus-packet-store-');
    cleanup.push(root);
    const { intent, work, context } = fixture();
    const packet = createWorkExecutionPacket({ intent, work, context });
    const store = new FileWorkExecutionPacketStore(root);

    const results = await Promise.all([store.save(packet), store.save(packet)]);
    expect(results.map(({ status }) => status).sort()).toEqual(['created', 'reused']);
    const loaded = await store.load(intent.runId, packet.identity);
    expect(loaded).toEqual(packet);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.context.layers[0])).toBe(true);
    const files = await readdir(path.join(root, '.repoctopus', 'runs', intent.runId, 'packets'));
    expect(files).toEqual([`${packet.identity.packetDigest.slice('sha256:'.length)}.json`]);
  });

  it('fails closed for corrupt content and unsafe Run identities', async () => {
    const root = await temporaryDirectory('repoctopus-packet-store-corrupt-');
    cleanup.push(root);
    const { intent, work, context } = fixture();
    const packet = createWorkExecutionPacket({ intent, work, context });
    const store = new FileWorkExecutionPacketStore(root);
    await store.save(packet);
    const file = path.join(
      root,
      '.repoctopus',
      'runs',
      intent.runId,
      'packets',
      `${packet.identity.packetDigest.slice('sha256:'.length)}.json`,
    );
    await writeFile(
      file,
      JSON.stringify({
        ...packet,
        context: {
          ...packet.context,
          layers: packet.context.layers.map((layer, index) =>
            index === 0 ? { ...layer, content: 'tampered' } : layer,
          ),
        },
      }),
    );

    await expect(store.load(intent.runId, packet.identity)).rejects.toThrow(
      /packet identity does not match its content/iu,
    );
    await expect(store.load('../escape', packet.identity)).rejects.toThrow(/Invalid run id/iu);
  });

  it('distinguishes missing and truncated packet content without creating fallback files', async () => {
    const root = await temporaryDirectory('repoctopus-packet-store-missing-');
    cleanup.push(root);
    const { intent, work, context } = fixture();
    const packet = createWorkExecutionPacket({ intent, work, context });
    const store = new FileWorkExecutionPacketStore(root);
    await expect(store.load(intent.runId, packet.identity)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await store.save(packet);
    const file = path.join(
      root,
      '.repoctopus',
      'runs',
      intent.runId,
      'packets',
      `${packet.identity.packetDigest.slice('sha256:'.length)}.json`,
    );
    await writeFile(file, '{"schemaVersion":2');
    await expect(store.load(intent.runId, packet.identity)).rejects.toBeInstanceOf(SyntaxError);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });
});
