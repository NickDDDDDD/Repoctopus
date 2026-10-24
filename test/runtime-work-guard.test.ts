import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';

import type { ActionIntent } from '../domains/action/types.js';
import {
  authorizeRuntimeWorkOperation,
  observeUnmanagedRuntimeMutation,
  type RuntimeWorkClaimReference,
  type RuntimeWorkOperation,
} from '../domains/change-lifecycle/work-guard.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { RunState } from '../domains/engine/types.js';
import { CommandRouter } from '../services/command-router.js';
import { RuntimeWorkGuard } from '../services/runtime-work-guard.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

const claim: RuntimeWorkClaimReference = {
  runId: 'run-1',
  workId: 'design:plan',
  attempt: 1,
  claimToken: digest('c'),
  inputDigest: digest('i'),
};

function designWork(overrides: Partial<WorkDescriptor> = {}): WorkDescriptor {
  return {
    schemaVersion: 1,
    workId: claim.workId,
    phase: 'design',
    kind: 'specification.plan',
    augmentationSkills: [],
    methodProfile: {
      id: 'repoctopus.design',
      version: '1.0.0',
      digest: digest('m'),
      sourceDigests: [],
      ruleIds: [],
    },
    capabilities: ['specification.write'],
    sideEffectClass: 'specification-write',
    writeScopes: [
      {
        repositoryId: 'workspace',
        paths: ['openspec/changes/**'],
        operations: ['create', 'update'],
      },
    ],
    inputDigest: claim.inputDigest,
    outputContract: {
      artifactKinds: ['proposal', 'delta-specs', 'design', 'tasks'],
      trackerPublish: false,
    },
    validatorProfile: { id: 'design.artifacts-valid', version: '1.0.0', digest: digest('v') },
    authorizationSource: {
      kind: 'lifecycle-definition',
      definitionId: 'repoctopus-change',
      definitionVersion: '1.1.0',
    },
    checkpoint: 'design.after-validation',
    ...overrides,
  };
}

function run(work = designWork()): RunState {
  return {
    schemaVersion: 1,
    runId: claim.runId,
    status: 'running',
    changeLifecycle: {
      schemaVersion: 1,
      identity: { workspaceId: 'team', changeId: 'guard', generation: 1, runId: claim.runId },
      definition: { id: 'repoctopus-change', version: '1.1.0', digest: digest('d') },
      revision: 1,
      phase: work.phase,
      currentWork: work,
      waitCondition: null,
      blocker: null,
    },
    specificationUsageSnapshot: {
      schemaVersion: 1,
      changeId: 'guard',
      provider: {
        id: 'specification-openspec',
        version: '1.0.0',
        protocolVersion: 'repoctopus.specification/v1alpha1',
      },
      validationDigest: digest('s'),
    },
  } as RunState;
}

function intent(): ActionIntent {
  return {
    schemaVersion: 2,
    intentId: 'intent-1',
    idempotencyKey: 'key-1',
    ...claim,
    compositionDigest: digest('o'),
    composition: {} as ActionIntent['composition'],
    action: {} as ActionIntent['action'],
    adapter: 'openspec',
    createdAt: '2026-10-24T00:00:00.000Z',
  };
}

function specificationWrite(
  overrides: Omit<
    Partial<Extract<RuntimeWorkOperation, { kind: 'specification-write' }>>,
    'claim'
  > & { claim?: RuntimeWorkClaimReference | undefined } = {},
): Extract<RuntimeWorkOperation, { kind: 'specification-write' }> {
  const { claim: claimOverride, ...rest } = overrides;
  return {
    kind: 'specification-write',
    adapterId: 'openspec',
    repositoryId: 'workspace',
    path: 'openspec/changes/guard/design.md',
    operation: 'update',
    providerId: 'specification-openspec',
    artifactKind: 'design',
    terminalArtifact: false,
    ...rest,
    ...(claimOverride === undefined && 'claim' in overrides ? {} : { claim: claimOverride ?? claim }),
  };
}

describe('Runtime Work Guard', () => {
  it('authorizes an exact active claim, Provider artifact, capability, and write scope', () => {
    expect(
      authorizeRuntimeWorkOperation({ state: run(), intent: intent(), operation: specificationWrite() }),
    ).toEqual({ runId: claim.runId, workId: claim.workId, attempt: 1, operation: 'specification-write' });
  });

  it.each([
    ['missing claim', specificationWrite({ claim: undefined }), 'active Action claim'],
    ['cross-repository write', specificationWrite({ repositoryId: 'backend' }), 'does not allow'],
    ['terminal artifact rewrite', specificationWrite({ terminalArtifact: true }), 'immutable'],
    ['wrong Adapter', specificationWrite({ adapterId: 'filesystem' }), 'Adapter does not match'],
    ['wrong Provider', specificationWrite({ providerId: 'foreign-spec' }), 'Provider does not match'],
    ['wrong artifact kind', specificationWrite({ artifactKind: 'verification' }), 'output contract'],
  ])('rejects %s before a side effect', (_name, operation, message) => {
    expect(() => authorizeRuntimeWorkOperation({ state: run(), intent: intent(), operation })).toThrow(
      message,
    );
  });

  it('rejects Design tracker publication even when an Adapter has platform capability', () => {
    const work = designWork({ capabilities: ['platform.mutate'] });
    expect(() =>
      authorizeRuntimeWorkOperation({
        state: run(work),
        intent: intent(),
        operation: { kind: 'tracker-publish', adapterId: 'openspec', claim },
      }),
    ).toThrow('may not publish tracker state');
  });

  it('classifies an unmanaged external mutation as drift, never success', () => {
    expect(
      observeUnmanagedRuntimeMutation({
        repositoryId: 'backend',
        path: 'src/unmanaged.ts',
      }),
    ).toEqual({
      kind: 'runtime-work-drift',
      status: 'drift',
      success: false,
      repositoryId: 'backend',
      path: 'src/unmanaged.ts',
      reason: 'Mutation was observed without a matching Runtime Work claim',
    });
  });

  it('makes Command Router invoke the guard before a managed handler', async () => {
    const context = new Context();
    const router = new CommandRouter(context);
    const guard = new RuntimeWorkGuard(context);
    const operation = specificationWrite();
    const authorize = vi.spyOn(guard, 'authorize').mockResolvedValue({
      runId: claim.runId,
      workId: claim.workId,
      attempt: 1,
      operation: operation.kind,
    });
    const execute = vi.fn(() => Promise.resolve('written'));
    router.register({ name: 'managed.write', runtimeWork: () => operation, execute });

    await expect(router.execute('managed.write', {})).resolves.toBe('written');
    expect(authorize).toHaveBeenCalledWith(operation);
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]!);
    await context.fiber.dispose();
  });
});
