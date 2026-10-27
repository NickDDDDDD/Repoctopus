import { describe, expect, it } from 'vitest';

import { createExecutionContext } from '../domains/telemetry/execution-context.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';

function work(): WorkDescriptor {
  return {
    schemaVersion: 2,
    workId: 'build:2.2:context',
    checkEpoch: 16,
    phase: 'build',
    kind: 'task.implement',
    taskId: '2.2',
    taskRevision: `sha256:${'a'.repeat(64)}`,
    augmentationSkills: [],
    methodProfile: {
      id: 'repoctopus.build',
      version: '1.0.0',
      digest: `sha256:${'b'.repeat(64)}`,
      sourceDigests: [],
      ruleIds: [],
    },
    capabilities: ['repository.write'],
    sideEffectClass: 'repository-write',
    writeScopes: [],
    inputDigest: `sha256:${'c'.repeat(64)}`,
    outputContract: { artifactKinds: [], trackerPublish: false },
    validatorProfile: {
      id: 'build.task-valid',
      version: '1.0.0',
      digest: `sha256:${'d'.repeat(64)}`,
    },
    authorizationSource: {
      kind: 'lifecycle-definition',
      definitionId: 'repoctopus-change',
      definitionVersion: '3.0.0',
    },
    checkpoint: 'build.before-task',
  };
}

describe('execution telemetry context', () => {
  it('constructs one immutable context from the authoritative Work and claim', () => {
    const descriptor = work();
    const context = createExecutionContext({
      work: descriptor,
      claim: {
        workId: descriptor.workId,
        attempt: 3,
        checkEpoch: descriptor.checkEpoch,
      },
    });

    expect(context).toEqual({
      schemaVersion: 1,
      phase: 'build',
      work: { id: 'build:2.2:context', kind: 'task.implement' },
      attempt: 3,
      checkEpoch: 16,
      task: { id: '2.2', revision: `sha256:${'a'.repeat(64)}` },
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.work)).toBe(true);
    expect(Object.isFrozen(context.task)).toBe(true);
  });

  it('rejects a claim that is not bound to the same Work and checkEpoch', () => {
    const descriptor = work();
    expect(() =>
      createExecutionContext({
        work: descriptor,
        claim: { workId: 'build:other', attempt: 1, checkEpoch: descriptor.checkEpoch },
      }),
    ).toThrow(/authoritative Work/iu);
    expect(() =>
      createExecutionContext({
        work: descriptor,
        claim: { workId: descriptor.workId, attempt: 1, checkEpoch: 99 },
      }),
    ).toThrow(/checkEpoch/iu);
  });
});
