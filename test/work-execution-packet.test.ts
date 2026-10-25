import { describe, expect, it } from 'vitest';

import type { ActionIntent } from '../domains/action/types.js';
import type { WorkExecutionContext } from '../domains/change-lifecycle/work-context.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import {
  assertPacketIdentity,
  createWorkExecutionPacket,
} from '../domains/work-execution/types.js';
import { compositionFixture } from './helpers/fixtures.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

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
    schemaVersion: 1,
    workId: context.workId,
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
    schemaVersion: 2,
    intentId: 'intent-1',
    idempotencyKey: 'idempotency-1',
    runId: 'run-1',
    workId: work.workId,
    attempt: 1,
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
});
