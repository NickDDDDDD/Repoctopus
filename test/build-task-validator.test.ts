import { describe, expect, it } from 'vitest';

import { validateBuildTaskOutcome } from '../domains/change-lifecycle/build-validator.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { ActionReceipt } from '../domains/action/types.js';
import type { RunState } from '../domains/engine/types.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const pending = parseSpecificationTasks('build-validator', '- [ ] 1.1 Build it.\n');

function work(): WorkDescriptor {
  return {
    schemaVersion: 1,
    workId: 'build:1.1:test',
    phase: 'build',
    kind: 'task.implement',
    taskId: '1.1',
    taskRevision: pending.tasks[0]!.taskRevision,
    augmentationSkills: [],
    methodProfile: {
      id: 'repoctopus.build',
      version: '1.0.0',
      digest: digest('m'),
      sourceDigests: [],
      ruleIds: [],
    },
    capabilities: ['repository.write'],
    sideEffectClass: 'repository-write',
    writeScopes: [],
    inputDigest: digest('i'),
    outputContract: { artifactKinds: [], trackerPublish: false },
    validatorProfile: { id: 'build.task-valid', version: '1.0.0', digest: digest('v') },
    authorizationSource: {
      kind: 'lifecycle-definition',
      definitionId: 'repoctopus-change',
      definitionVersion: '1.1.0',
    },
    checkpoint: 'build.before-task',
  };
}

function state(): RunState {
  const currentWork = work();
  return {
    schemaVersion: 1,
    runId: 'run-1',
    status: 'running',
    changeLifecycle: {
      schemaVersion: 1,
      identity: {
        workspaceId: 'team',
        changeId: 'build-validator',
        generation: 1,
        mode: 'fresh',
        runId: 'run-1',
      },
      definition: { id: 'repoctopus-change', version: '1.1.0', digest: digest('d') },
      revision: 1,
      phase: 'build',
      currentWork,
      waitCondition: null,
      blocker: null,
      tasks: pending.tasks,
      planningDigest: pending.digest,
    },
  } as unknown as RunState;
}

function receipt(overrides: Partial<ActionReceipt> = {}): ActionReceipt {
  return {
    schemaVersion: 2,
    receiptId: 'receipt-1',
    intentId: 'intent-1',
    idempotencyKey: 'key-1',
    runId: 'run-1',
    workId: work().workId,
    attempt: 1,
    claimToken: digest('c'),
    inputDigest: work().inputDigest,
    outcomeId: 'outcome-1',
    compositionDigest: digest('o'),
    actionId: work().workId,
    adapter: 'process',
    outcome: 'succeeded',
    summary: 'done',
    completedAt: '2026-10-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('Build Task validator', () => {
  it('distinguishes accepted, failed, input drift, Task revision drift, and replay', () => {
    expect(
      validateBuildTaskOutcome({ state: state(), receipt: receipt(), tasks: pending }),
    ).toMatchObject({
      status: 'validated',
      taskId: '1.1',
    });
    const failed = validateBuildTaskOutcome({
      state: state(),
      receipt: receipt({ outcome: 'failed', summary: 'test failed' }),
      tasks: pending,
    });
    expect(failed.status).toBe('failed');
    expect(failed.diagnostic).toContain('test failed');
    expect(
      validateBuildTaskOutcome({
        state: state(),
        receipt: receipt({ inputDigest: digest('x') }),
        tasks: pending,
      }),
    ).toMatchObject({ status: 'input-drift' });
    const revised = parseSpecificationTasks('build-validator', '- [ ] 1.1 Build it safely.\n');
    expect(
      validateBuildTaskOutcome({ state: state(), receipt: receipt(), tasks: revised }),
    ).toMatchObject({ status: 'task-revision-changed' });
    const completed = parseSpecificationTasks('build-validator', '- [x] 1.1 Build it.\n');
    expect(
      validateBuildTaskOutcome({ state: state(), receipt: receipt(), tasks: completed }),
    ).toMatchObject({ status: 'already-completed' });
  });
});
