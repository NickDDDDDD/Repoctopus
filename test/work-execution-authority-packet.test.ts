import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ActionIntent } from '../domains/action/types.js';
import type { RunState } from '../domains/engine/types.js';
import type { WorkExecutionContext } from '../domains/change-lifecycle/work-context.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import { createWorkExecutionPacket } from '../domains/work-execution/types.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';
import { compositionFixture } from './helpers/fixtures.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function rawDigest(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

describe('Work execution authoritative packet', () => {
  it('replays a frozen packet after a compatible Runtime composition adoption', async () => {
    const composition = compositionFixture();
    const work: WorkDescriptor = {
      schemaVersion: 2,
      workId: 'build.configure:compatible-adoption',
      checkEpoch: 12,
      phase: 'build',
      kind: 'build.configure',
      actionSkill: {
        schemaVersion: 1,
        name: 'repoctopus-build-configure',
        provider: 'repoctopus-lifecycle',
        invocation: { modelInvocable: true, userInvocable: false },
        contentDigest: digest('6'),
        resourceManifestDigest: digest('7'),
      },
      augmentationSkills: [],
      methodProfile: {
        id: 'repoctopus.build',
        version: '1.0.0',
        digest: digest('1'),
        sourceDigests: [],
        ruleIds: [],
      },
      capabilities: [],
      sideEffectClass: 'none',
      writeScopes: [],
      inputDigest: digest('2'),
      outputContract: { artifactKinds: [], trackerPublish: false },
      validatorProfile: {
        id: 'build.binding-valid',
        version: '1.0.0',
        digest: digest('3'),
      },
      authorizationSource: {
        kind: 'lifecycle-definition',
        definitionId: 'repoctopus-change',
        definitionVersion: '4.8.0',
      },
      checkpoint: 'build.before-configure',
    };
    const context: WorkExecutionContext = {
      schemaVersion: 1,
      workId: work.workId,
      digest: digest('4'),
      layers: [],
    };
    const runId = 'run-compatible-adoption';
    const attempt = 1;
    const adapter = 'process';
    const idempotencyKey = rawDigest(
      runId,
      work.workId,
      String(attempt),
      String(work.checkEpoch),
      work.inputDigest,
      adapter,
    );
    const intent: ActionIntent = {
      schemaVersion: 3,
      intentId: rawDigest('intent', idempotencyKey),
      idempotencyKey,
      runId,
      workId: work.workId,
      attempt,
      checkEpoch: work.checkEpoch,
      claimToken: `sha256:${rawDigest('claim', idempotencyKey)}`,
      inputDigest: work.inputDigest,
      compositionDigest: composition.compositionDigest,
      composition,
      action: {
        id: work.workId,
        stepId: 'build:build.configure',
        type: 'invoke_skill',
        ref: 'repoctopus-build-configure',
        summary: 'Execute build.configure',
      },
      adapter,
      executionContext: { digest: context.digest, layers: [] },
      createdAt: '2026-11-03T00:00:00.000Z',
    };
    const packet = createWorkExecutionPacket({ intent, work, context });
    const state = {
      runId,
      status: 'running',
      composition: {
        ...composition,
        compositionDigest: digest('5'),
      },
      changeLifecycle: {
        checkEpoch: work.checkEpoch,
        currentWork: work,
      },
      workExecution: {
        schemaVersion: 3,
        workId: work.workId,
        attempt,
        checkEpoch: work.checkEpoch,
        intentId: intent.intentId,
        claimToken: intent.claimToken,
        inputDigest: work.inputDigest,
        packet: packet.identity,
        status: 'outcome',
        continuation: 'wait',
        updatedAt: '2026-11-03T00:01:00.000Z',
      },
    } as unknown as RunState;
    const authority = Object.create(WorkExecutionAuthority.prototype) as WorkExecutionAuthority;
    Object.defineProperty(authority, 'ctx', {
      value: {
        runStore: { loadRun: vi.fn().mockResolvedValue(state) },
        actionStore: { loadIntent: vi.fn().mockResolvedValue(intent) },
        workExecutionPacketStore: { load: vi.fn().mockResolvedValue(packet) },
      },
    });

    await expect(authority.loadAuthoritativePacket(runId)).resolves.toEqual({ intent, packet });
  });
});
