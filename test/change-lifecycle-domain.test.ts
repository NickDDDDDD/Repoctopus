import { describe, expect, it } from 'vitest';

import {
  CHANGE_PHASES,
  applyChangeLifecycleTransition,
  assertChangeLifecycleSnapshot,
  evolveChangeLifecycle,
  projectChangeRun,
  type ChangeLifecycleDefinition,
  type ChangeLifecycleSnapshot,
  type ChangeRunBlocker,
  type RunStatus,
  type WaitCondition,
  type WorkDescriptor,
} from '../domains/change-lifecycle/transition.js';
import type { SpecificationTask } from '../domains/specification/types.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';

const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;

const definition: ChangeLifecycleDefinition = {
  schemaVersion: 1,
  id: 'repoctopus-change',
  version: '1.0.0',
  phases: CHANGE_PHASES.map((phase) => ({
    phase,
    workKinds: [`${phase}.work`],
    requiredValidatorProfiles: [`${phase}.validator`],
    extensionCheckpoints: [`after-${phase}`],
  })),
  transitions: [
    {
      id: 'open.ready',
      kind: 'advance',
      from: { phase: 'open', statuses: ['running'] },
      to: { phase: 'design', status: 'running' },
      trigger: 'intake-ready',
      requiredValidatorProfile: 'open.validator',
    },
    {
      id: 'design.await-approval',
      kind: 'self',
      from: { phase: 'design', statuses: ['running'] },
      to: { phase: 'design', status: 'waiting' },
      trigger: 'planning-valid',
      requiredValidatorProfile: 'design.validator',
    },
    {
      id: 'design.approved',
      kind: 'advance',
      from: { phase: 'design', statuses: ['waiting'] },
      to: { phase: 'build', status: 'running' },
      trigger: 'approval-accepted',
    },
    {
      id: 'build.validated',
      kind: 'advance',
      from: { phase: 'build', statuses: ['running'] },
      to: { phase: 'verify', status: 'running' },
      trigger: 'all-tasks-validated',
      requiredValidatorProfile: 'build.validator',
    },
    {
      id: 'build.plan-drift',
      kind: 'fallback',
      from: { phase: 'build', statuses: ['running', 'blocked'] },
      to: { phase: 'design', status: 'blocked' },
      trigger: 'planning-semantic-drift',
    },
    {
      id: 'verify.failed',
      kind: 'fallback',
      from: { phase: 'verify', statuses: ['running'] },
      to: { phase: 'build', status: 'blocked' },
      trigger: 'verification-failed',
      requiredValidatorProfile: 'verify.validator',
    },
    {
      id: 'verify.passed',
      kind: 'advance',
      from: { phase: 'verify', statuses: ['running'] },
      to: { phase: 'archive', status: 'running' },
      trigger: 'verification-passed',
      requiredValidatorProfile: 'verify.validator',
    },
    {
      id: 'archive.await-merges',
      kind: 'self',
      from: { phase: 'archive', statuses: ['running'] },
      to: { phase: 'archive', status: 'waiting' },
      trigger: 'business-mrs-published',
    },
    {
      id: 'archive.completed',
      kind: 'complete',
      from: { phase: 'archive', statuses: ['waiting', 'running'] },
      to: { phase: 'archive', status: 'completed' },
      trigger: 'change-closed-and-final-mr-ready',
      requiredValidatorProfile: 'archive.validator',
    },
  ],
};

function initialSnapshot(
  overrides: Partial<ChangeLifecycleSnapshot> = {},
): ChangeLifecycleSnapshot {
  return {
    schemaVersion: 1,
    identity: {
      workspaceId: 'team-platform',
      changeId: 'establish-change-lifecycle',
      generation: 1,
      runId: 'change-run-1',
    },
    definition: {
      id: definition.id,
      version: definition.version,
      digest: digest('d'),
    },
    revision: 0,
    phase: 'open',
    status: 'running',
    currentWork: null,
    waitCondition: null,
    blocker: null,
    ...overrides,
  };
}

function approvalWait(): WaitCondition {
  return {
    schemaVersion: 1,
    waitId: 'wait-design-approval',
    kind: 'human-decision',
    reason: 'Planning artifacts need a trusted decision.',
    inputDigest: digest('i'),
    requestId: 'decision-1',
    proposalDigest: digest('p'),
  };
}

function mergeWait(): WaitCondition {
  return {
    schemaVersion: 1,
    waitId: 'wait-business-merges',
    kind: 'platform-event',
    reason: 'The complete Business MR set has not merged.',
    inputDigest: digest('i'),
    eventType: 'merge-request.merged',
    subjectDigest: digest('m'),
  };
}

function blocker(status: RunStatus): ChangeRunBlocker {
  return {
    code: `change.${status}`,
    message: `Change is ${status}`,
    evidenceIds: ['evidence-1'],
    sinceRevision: 0,
  };
}

const cleared = { currentWork: null, waitCondition: null, blocker: null } as const;

const buildTask: SpecificationTask = {
  taskId: '1.1',
  taskRevision: digest('t'),
  title: 'Build it',
  level: 0,
  status: 'pending',
  blockedBy: [],
};

const buildWork: WorkDescriptor = {
  schemaVersion: 1,
  workId: 'build:1.1:test',
  phase: 'build',
  kind: 'task.implement',
  taskId: buildTask.taskId,
  taskRevision: buildTask.taskRevision,
  augmentationSkills: [],
  methodProfile: {
    id: 'build',
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
    definitionId: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.id,
    definitionVersion: BUILTIN_CHANGE_LIFECYCLE_DEFINITION.version,
  },
  checkpoint: 'build.before-task',
};

describe('Change lifecycle domain', () => {
  it('owns Open and Design gate decisions in the canonical reducer', () => {
    const opened = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: createChangeLifecycleSnapshot({ identity: initialSnapshot().identity }),
      observation: { kind: 'open-intake-ready' },
    });
    expect(opened.snapshot).toMatchObject({ phase: 'design', status: 'running' });

    const waiting = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: opened.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'waiting',
        reason: 'Trusted Human Decision required',
        evidenceIds: [digest('e')],
        inputDigest: digest('i'),
        requestId: 'decision-1',
        proposalDigest: digest('p'),
      },
    });
    expect(waiting.snapshot).toMatchObject({
      phase: 'design',
      status: 'waiting',
      waitCondition: { kind: 'human-decision', requestId: 'decision-1' },
    });
    expect(
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: waiting.snapshot,
        observation: {
          kind: 'design-gate',
          result: 'waiting',
          reason: 'Trusted Human Decision required',
          evidenceIds: [digest('e')],
          inputDigest: digest('i'),
          requestId: 'decision-1',
          proposalDigest: digest('p'),
        },
      }).fact,
    ).toBeNull();

    const approved = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: waiting.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'approved',
        reason: 'Trusted decision accepted',
        evidenceIds: [digest('e')],
        inputDigest: digest('i'),
        tasks: [buildTask],
        work: buildWork,
      },
    });
    expect(approved.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      currentWork: { workId: buildWork.workId, taskId: buildTask.taskId },
    });

    const blocked = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: opened.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'blocked',
        reason: 'Strict validation failed',
        evidenceIds: [digest('v')],
        inputDigest: digest('v'),
      },
    });
    expect(blocked.snapshot).toMatchObject({
      phase: 'design',
      status: 'blocked',
      blocker: { code: 'design.planning-invalid' },
    });
  });

  it('advances only through declared phases and completes inside Archive', () => {
    let state = initialSnapshot();
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'open.ready',
      next: cleared,
    }).snapshot;
    expect(state).toMatchObject({ phase: 'design', status: 'running', revision: 1 });

    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'design.await-approval',
      next: { ...cleared, waitCondition: approvalWait() },
    }).snapshot;
    expect(state).toMatchObject({ phase: 'design', status: 'waiting', revision: 2 });

    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'design.approved',
      next: cleared,
    }).snapshot;
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'build.validated',
      next: cleared,
    }).snapshot;
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'verify.passed',
      next: cleared,
    }).snapshot;
    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'archive.await-merges',
      next: { ...cleared, waitCondition: mergeWait() },
    }).snapshot;
    const completed = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'archive.completed',
      next: cleared,
    });

    expect(completed.snapshot).toMatchObject({
      phase: 'archive',
      status: 'completed',
      revision: 7,
    });
    expect(completed.fact).toMatchObject({
      transitionId: 'archive.completed',
      from: { phase: 'archive', status: 'waiting' },
      to: { phase: 'archive', status: 'completed' },
      waitId: null,
    });
  });

  it('rejects an undeclared phase jump without changing the current snapshot', () => {
    const current = initialSnapshot();
    const before = structuredClone(current);

    expect(() =>
      applyChangeLifecycleTransition({
        definition,
        current,
        transitionId: 'design.approved',
        next: cleared,
      }),
    ).toThrow('design.approved is not valid from open/running');
    expect(current).toEqual(before);
  });

  it('keeps execution status orthogonal to every active phase', () => {
    const activeStatuses: RunStatus[] = [
      'running',
      'waiting',
      'blocked',
      'failed',
      'migration_required',
    ];

    for (const phase of CHANGE_PHASES) {
      for (const status of activeStatuses) {
        const snapshot = initialSnapshot({
          phase,
          status,
          waitCondition: status === 'waiting' ? approvalWait() : null,
          blocker: ['blocked', 'failed', 'migration_required'].includes(status)
            ? blocker(status)
            : null,
        });
        expect(() => assertChangeLifecycleSnapshot(snapshot)).not.toThrow();
      }
    }
    expect(() =>
      assertChangeLifecycleSnapshot(
        initialSnapshot({ phase: 'verify', status: 'completed', revision: 9 }),
      ),
    ).toThrow('must finish in Archive');
  });

  it('returns identical transition facts and query projections for identical inputs', () => {
    const input = {
      definition,
      current: initialSnapshot(),
      transitionId: 'open.ready',
      next: cleared,
    } as const;

    const first = applyChangeLifecycleTransition(input);
    const repeated = applyChangeLifecycleTransition(input);
    expect(repeated).toEqual(first);
    const projectionDetails = {
      taskProgress: { total: 4, completed: 0, currentTaskId: null },
      evidence: {
        gateStatus: 'not-evaluated' as const,
        acceptedBundleIds: [],
        latestAttemptId: null,
      },
      nextActions: [{ id: 'design.next', kind: 'work' as const, label: 'Continue Design' }],
      freshness: {
        stateVersion: 1,
        trajectoryOffset: 2,
        observedAt: '2026-10-24T00:00:00.000Z',
      },
    };
    expect(projectChangeRun(first.snapshot, projectionDetails)).toEqual(
      projectChangeRun(repeated.snapshot, projectionDetails),
    );
  });
});
