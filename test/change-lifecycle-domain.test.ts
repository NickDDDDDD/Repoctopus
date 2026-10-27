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
import type { VerificationInput } from '../domains/change-lifecycle/verification-input.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';

const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;

const definition: ChangeLifecycleDefinition = {
  schemaVersion: 2,
  id: 'repoctopus-change',
  version: '1.0.0',
  phases: CHANGE_PHASES.map((phase) => ({
    phase,
    workKinds: [`${phase}.work`],
    requiredValidatorProfiles: [`${phase}.validator`],
    extensionCheckpoints: [`after-${phase}`],
  })),
  works: structuredClone(BUILTIN_CHANGE_LIFECYCLE_DEFINITION.works),
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
    schemaVersion: 2,
    identity: {
      workspaceId: 'team-platform',
      changeId: 'establish-change-lifecycle',
      runId: 'change-run-1',
    },
    definition: {
      id: definition.id,
      version: definition.version,
      digest: digest('d'),
    },
    revision: 0,
    checkEpoch: 0,
    phase: 'open',
    status: 'running',
    currentWork: null,
    waitCondition: null,
    blocker: null,
    ...overrides,
  };
}

function builtinSnapshot(
  overrides: Partial<ChangeLifecycleSnapshot> = {},
): ChangeLifecycleSnapshot {
  return {
    ...createChangeLifecycleSnapshot({ identity: initialSnapshot().identity }),
    status: 'running',
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
    kind: 'external-fact',
    reason: 'The complete Business MR set has not merged.',
    inputDigest: digest('i'),
    providerId: 'merge-request-provider',
    factIdentityDigest: digest('m'),
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
  completion: null,
  blockedBy: [],
  acceptanceCriteria: [],
  requirementRefs: [],
};

const buildWork: WorkDescriptor = {
  schemaVersion: 2,
  workId: 'build:1.1:test',
  checkEpoch: 4,
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

function phaseWork(
  phase: WorkDescriptor['phase'],
  kind: WorkDescriptor['kind'],
  checkEpoch: number,
  inputDigest: `sha256:${string}`,
): WorkDescriptor {
  const base = structuredClone(buildWork);
  delete base.taskId;
  delete base.taskRevision;
  return {
    ...base,
    workId: `${phase}:${kind}:${checkEpoch}`,
    checkEpoch,
    phase,
    kind,
    inputDigest,
  };
}

function verificationInput(checkEpoch: number, value: string): VerificationInput {
  return {
    schemaVersion: 2,
    runId: initialSnapshot().identity.runId,
    checkEpoch,
    taskRevisions: [{ taskId: buildTask.taskId, taskRevision: buildTask.taskRevision }],
    acceptanceCriteria: [],
    acceptanceSetHash: digest('a'),
    acceptanceCoverage: [],
    repositories: [
      {
        repositoryId: 'workspace',
        commit: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        dirtyFilesDigest: digest('c'),
      },
    ],
    projectConfigDigest: digest('p'),
    compositionDigest: digest('c'),
    skills: [],
    evidenceProfile: {
      id: 'verify',
      planDigest: digest('e'),
      fingerprintDigest: `fingerprint-${value}`,
    },
    digest: digest(value),
  };
}

describe('Change lifecycle domain', () => {
  it('owns Open and Design gate decisions in the canonical reducer', () => {
    const { taskId, taskRevision, ...workWithoutTask } = buildWork;
    void taskId;
    void taskRevision;
    const openWork: WorkDescriptor = {
      ...workWithoutTask,
      workId: 'open:intake',
      checkEpoch: 0,
      phase: 'open',
      kind: 'change.intake',
      inputDigest: digest('o'),
      validatorProfile: {
        id: 'open.intake-ready',
        version: '1.0.0',
        digest: digest('v'),
      },
    };
    const designWork: WorkDescriptor = {
      ...workWithoutTask,
      workId: 'design:plan',
      checkEpoch: 2,
      phase: 'design',
      kind: 'specification.plan',
      inputDigest: digest('p'),
      validatorProfile: {
        id: 'design.artifacts-valid',
        version: '1.0.0',
        digest: digest('v'),
      },
    };
    const openWaiting = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: {
        ...createChangeLifecycleSnapshot({ identity: initialSnapshot().identity }),
        currentWork: openWork,
      },
      observation: {
        kind: 'open-gate',
        result: 'waiting',
        reason: 'Review complete Open baseline',
        evidenceIds: [digest('e')],
        inputDigest: digest('o'),
        requestId: 'open-decision-1',
        proposalDigest: digest('q'),
      },
    });
    expect(openWaiting.snapshot).toMatchObject({ phase: 'open', status: 'waiting' });
    const opened = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: openWaiting.snapshot,
      observation: {
        kind: 'open-gate',
        result: 'approved',
        reason: 'Open baseline approved',
        evidenceIds: [digest('e')],
        inputDigest: digest('o'),
        work: designWork,
      },
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
      planningDigest: digest('i'),
    });

    const resumedCompleted = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: opened.snapshot,
      observation: {
        kind: 'design-gate',
        result: 'approved',
        reason: 'Trusted decision accepted for a completed Task projection',
        evidenceIds: [digest('e')],
        inputDigest: digest('i'),
        tasks: [{ ...buildTask, status: 'completed' }],
      },
    });
    expect(resumedCompleted.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      currentWork: null,
      tasks: [{ taskId: buildTask.taskId, status: 'completed' }],
      planningDigest: digest('i'),
    });

    const invalidated = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: approved.snapshot,
      observation: {
        kind: 'planning-semantic-drift',
        reason: 'Design artifact changed',
        evidenceIds: [digest('n')],
        inputDigest: digest('z'),
      },
    });
    expect(invalidated.snapshot).toMatchObject({
      phase: 'design',
      status: 'running',
      currentWork: null,
      tasks: [],
    });
    expect(invalidated.snapshot.planningDigest).toBeUndefined();
    expect(invalidated.fact).toMatchObject({
      transitionId: 'build.semantic-plan-drift',
      invalidation: {
        kind: 'planning-semantic-drift',
        supersededPlanningDigest: digest('i'),
        observedPlanningDigest: digest('z'),
        supersededWorkId: buildWork.workId,
        supersededTaskRevisions: [buildTask.taskRevision],
        evidenceIds: [digest('n')],
      },
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
      currentWork: null,
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
    expect(state.checkEpoch).toBe(1);

    state = applyChangeLifecycleTransition({
      definition,
      current: state,
      transitionId: 'design.await-approval',
      next: { ...cleared, waitCondition: approvalWait() },
    }).snapshot;
    expect(state).toMatchObject({ phase: 'design', status: 'waiting', revision: 2 });
    expect(state.checkEpoch).toBe(2);

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
      checkEpoch: 7,
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
    expect(() =>
      applyChangeLifecycleTransition({
        definition,
        current: initialSnapshot({
          revision: Number.MAX_SAFE_INTEGER,
          checkEpoch: Number.MAX_SAFE_INTEGER,
        }),
        transitionId: 'open.ready',
        next: cleared,
      }),
    ).toThrow(/cannot overflow/u);
  });

  it('keeps adoption, design rework, Verify repair/retry, and Archive reverify in one Run', () => {
    const imported = {
      ...buildTask,
      status: 'completed' as const,
      completion: { source: 'imported-claim' as const },
    };
    const adoptionRequired = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 4,
        checkEpoch: 4,
        phase: 'build',
        tasks: [imported],
        planningDigest: digest('p'),
      }),
      observation: {
        kind: 'build-adoption-required',
        requestId: 'adopt-1',
        proposalDigest: digest('a'),
        reason: 'Confirm imported completion claims',
      },
    });
    const adopted = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: adoptionRequired.snapshot,
      observation: {
        kind: 'build-adoption-decision',
        decision: 'approve',
        requestId: 'adopt-1',
        proposalDigest: digest('a'),
        actorId: 'trusted-user',
      },
    });
    expect(adopted.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      checkEpoch: 6,
      adoptedCompletionClaimDigest: digest('a'),
    });

    const activeBuild = builtinSnapshot({
      revision: 4,
      checkEpoch: 4,
      phase: 'build',
      currentWork: buildWork,
      tasks: [buildTask],
      planningDigest: digest('p'),
    });
    const designRequired = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: activeBuild,
      observation: {
        kind: 'build-design-revision-required',
        requestId: 'design-1',
        proposalDigest: digest('d'),
        reason: 'Repository facts invalidate the approved design',
        evidenceIds: ['receipt-1'],
      },
    });
    expect(designRequired.snapshot).toMatchObject({
      phase: 'build',
      status: 'waiting',
      checkEpoch: 5,
      currentWork: null,
    });
    const designWork = phaseWork('design', 'specification.plan', 6, digest('d'));
    const designApproved = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: designRequired.snapshot,
      observation: {
        kind: 'build-design-revision-decision',
        decision: 'approve',
        requestId: 'design-1',
        proposalDigest: digest('d'),
        actorId: 'trusted-user',
        work: designWork,
      },
    });
    expect(designApproved.snapshot).toMatchObject({
      phase: 'design',
      status: 'running',
      checkEpoch: 6,
      currentWork: { workId: designWork.workId },
      tasks: [],
    });
    const exhausted = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: activeBuild,
      observation: {
        kind: 'build-retry-exhausted',
        workId: buildWork.workId,
        attempt: 3,
        reason: 'Three bounded attempts failed',
      },
    });
    expect(exhausted.snapshot).toMatchObject({
      phase: 'build',
      status: 'blocked',
      checkEpoch: 5,
      currentWork: null,
      blocker: { code: 'build.retry-exhausted' },
    });

    const verifyInput = verificationInput(5, 'v');
    const verifyWork = phaseWork('verify', 'evidence.verify', 5, verifyInput.digest);
    const activeVerify = builtinSnapshot({
      revision: 5,
      checkEpoch: 5,
      phase: 'verify',
      currentWork: verifyWork,
      tasks: [{ ...buildTask, status: 'completed' }],
      planningDigest: digest('p'),
      verificationInput: verifyInput,
    });
    const repairWork = { ...buildWork, checkEpoch: 6 };
    const repaired = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: activeVerify,
      observation: {
        kind: 'verify-gate-rejected',
        workId: verifyWork.workId,
        inputDigest: verifyInput.digest,
        evidenceInputFingerprint: verifyInput.evidenceProfile.fingerprintDigest,
        attemptId: 'attempt-1',
        bundleId: 'bundle-1',
        reason: 'Behavioral acceptance failed',
        result: 'implementation-failure',
        checkEpoch: 5,
        tasks: [buildTask],
        work: repairWork,
      },
    });
    expect(repaired.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      checkEpoch: 6,
      currentWork: { workId: repairWork.workId },
      verificationInvalidation: { kind: 'implementation-drift' },
    });
    const repairCompleted = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: repaired.snapshot,
      observation: {
        kind: 'build-task-completed',
        workId: repairWork.workId,
        taskId: buildTask.taskId,
        taskRevision: buildTask.taskRevision,
        inputDigest: repairWork.inputDigest,
        receiptId: 'repair-receipt-1',
        tasks: [
          {
            ...buildTask,
            status: 'completed',
            completion: { source: 'runtime-work', workId: repairWork.workId },
          },
        ],
      },
    });
    expect(repairCompleted.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      currentWork: null,
      verificationInvalidation: { kind: 'implementation-drift' },
    });
    const retryInput = verificationInput(6, 'r');
    const retryWork = phaseWork('verify', 'evidence.verify', 6, retryInput.digest);
    const retried = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: activeVerify,
      observation: {
        kind: 'verify-gate-rejected',
        workId: verifyWork.workId,
        inputDigest: verifyInput.digest,
        evidenceInputFingerprint: verifyInput.evidenceProfile.fingerprintDigest,
        attemptId: 'attempt-2',
        bundleId: null,
        reason: 'Evidence infrastructure unavailable',
        result: 'evidence-unavailable',
        checkEpoch: 5,
        verificationInput: retryInput,
        work: retryWork,
      },
    });
    expect(retried.snapshot).toMatchObject({
      phase: 'verify',
      status: 'running',
      checkEpoch: 6,
      currentWork: { workId: retryWork.workId },
    });

    const reverifyInput = verificationInput(7, 'z');
    const reverifyWork = phaseWork('verify', 'evidence.verify', 7, reverifyInput.digest);
    const reverified = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: builtinSnapshot({
        revision: 6,
        checkEpoch: 6,
        phase: 'archive',
        tasks: [{ ...buildTask, status: 'completed' }],
        planningDigest: digest('p'),
        verificationInput: verifyInput,
      }),
      observation: {
        kind: 'archive-reverify-required',
        reason: 'Repository fingerprint changed before Archive side effects',
        verificationInput: reverifyInput,
        work: reverifyWork,
      },
    });
    expect(reverified.snapshot).toMatchObject({
      phase: 'verify',
      status: 'running',
      checkEpoch: 7,
      currentWork: { workId: reverifyWork.workId },
    });
    expect(reverified.snapshot.identity.runId).toBe(activeVerify.identity.runId);
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
