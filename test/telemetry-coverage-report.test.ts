import { describe, expect, it } from 'vitest';

import {
  assertCompleteObservationCoverage,
  createObservationCoverageReport,
  OBSERVATION_COVERAGE_REQUIREMENTS,
  type CoverageObservationRecord,
  type ObservationCoverageRequirement,
} from '../domains/telemetry/coverage-report.js';

const REAL_SOURCE = Object.freeze({
  runId: 'change-repoctopus-adopt-comet-single-run-lifecycle-1784ada21df4159c',
  trajectorySha256: 'a17d39d2025e0f6235702652b2924e7c0a54789adca426ac04ec2671d2fdcd5b',
});

function real(
  eventId: string,
  timestamp: string,
  type: string,
  data: Record<string, unknown>,
): CoverageObservationRecord {
  return { eventId, timestamp, type, runId: REAL_SOURCE.runId, data };
}

function synthetic(
  order: number,
  type: string,
  data: Record<string, unknown>,
): CoverageObservationRecord {
  return {
    eventId: `synthetic:${String(order).padStart(2, '0')}:${type}`,
    timestamp: `2026-10-26T00:38:${String(order).padStart(2, '0')}.000Z`,
    type,
    runId: REAL_SOURCE.runId,
    data,
  };
}

function transition(
  fromPhase: string,
  toPhase: string,
  toStatus: string,
  workId: string | null = null,
  workKind: string | null = null,
): Record<string, unknown> {
  return {
    changeLifecycleTransition: {
      from: { phase: fromPhase },
      to: { phase: toPhase, status: toStatus },
      workId,
      work: workId && workKind ? { workId, kind: workKind } : null,
    },
  };
}

const openWork = `${REAL_SOURCE.runId}:change.intake:cc696085ac4bbb50`;

// Curated, identity-preserving records from the pinned self-bootstrap Trajectory. The
// source predates the newer Task, Evidence-attempt, Host-tool and pipeline-health
// contracts, so those contracts are supplied below as explicit synthetic fault records.
const REAL_SELF_BOOTSTRAP_SLICE: readonly CoverageObservationRecord[] = Object.freeze([
  real(
    '718ff4ff982a49c21a05ae27aa0c49d039dfc8320cff0211e3aa248155f273b0',
    '2026-10-25T23:15:17.640Z',
    'run.started',
    { phase: 'open' },
  ),
  real(
    'sha256:790a2a16abe8424f590fafff7ea9cb9acf1bcbac4df49ad51b13a9558737cd1a',
    '2026-10-25T23:15:17.760Z',
    'work.created',
    { phase: 'open', workId: openWork, workKind: 'change.intake' },
  ),
  real(
    'sha256:148a002944aba74f50ae5425bc7e8fa3bbe1757dae2a117bc0435753d781d8e0',
    '2026-10-25T23:15:34.189Z',
    'work.claimed',
    { phase: 'open', workId: openWork, workKind: 'change.intake', attempt: 1 },
  ),
  real(
    'sha256:38e33b30855732976e59ff01ea165c3b7e2a53bbf37d5c39a4c914a542573683',
    '2026-10-25T23:15:34.211Z',
    'skill.resolved',
    {
      phase: 'open',
      workId: openWork,
      workKind: 'change.intake',
      attempt: 1,
      skillName: 'repoctopus-open-change',
      skillRole: 'action',
    },
  ),
  real(
    'sha256:70a90487521bace8b824ba97d94c166741b653c5ed1cffc75c5829d4c7a2057e',
    '2026-10-25T23:15:34.255Z',
    'work.context-delivered',
    { workId: openWork, attempt: 1 },
  ),
  real(
    'sha256:acc0277a17f6f258296799b77a6d4bcf742858dba4b9fb45f26f099f588c4a0d',
    '2026-10-25T23:15:34.276Z',
    'skill.delivered',
    {
      phase: 'open',
      workId: openWork,
      workKind: 'change.intake',
      attempt: 1,
      skillName: 'repoctopus-open-change',
      skillRole: 'action',
    },
  ),
  real(
    'sha256:1ebaeda8e9559bfe4cb744c27eae0f7479bf68cffd47d8fe6f0e9bc6ba140365',
    '2026-10-25T23:15:34.319Z',
    'work.host-started',
    { workId: openWork, attempt: 1 },
  ),
  real(
    'sha256:08629d2f0d5517b16b12ac775b2e5657d42edfc8d83be81977dbb7ca2deba6d3',
    '2026-10-25T23:16:41.644Z',
    'work.host-completed',
    { workId: openWork, attempt: 1, result: 'succeeded' },
  ),
  real(
    'sha256:acc712b0f518d654a510985943ac91c0609d6d6f78df6d346b7fb50a5a18da88',
    '2026-10-25T23:16:41.667Z',
    'skill.consumed',
    {
      phase: 'open',
      workId: openWork,
      workKind: 'change.intake',
      attempt: 1,
      skillName: 'repoctopus-open-change',
      skillRole: 'action',
    },
  ),
  real(
    'sha256:2fcb33b82a6b4e06dcd1d115f36bac33a9ce4c80e71bee56ef3c12c54991d1a4',
    '2026-10-25T23:16:41.715Z',
    'work.completed',
    { workId: openWork, attempt: 1, result: 'succeeded' },
  ),
  real(
    'sha256:f81da4d7817d67df3e52d79299e60319a8ff81b09280376dde3e19ee453608cd',
    '2026-10-25T23:16:49.371Z',
    'validator.completed',
    { workId: openWork, attempt: 1, result: 'accepted' },
  ),
  real(
    'sha256:91f18e7fec884eca9b3c1c1aeeb6b3ce184f10e6813a3233726a2b126c6c1578',
    '2026-10-25T23:16:56.633Z',
    'wait.started',
    { waitId: 'open-approval:89341459-1f7e-4183-a61b-60845382f900' },
  ),
  real(
    'sha256:db7442ebd576100eb9026aaa52403c0273101e9b4a0f20d4f67d2ff7ac6ed596',
    '2026-10-25T23:16:56.655Z',
    'continuation.selected',
    { continuation: 'ask', workId: openWork, attempt: 1 },
  ),
  real(
    '2426e33ad76ebbe10b0ebb0a1d062492b2ba31251f0d33d652b286628ab18dae',
    '2026-10-25T23:17:37.797Z',
    'change.lifecycle.transitioned',
    transition('open', 'design', 'running'),
  ),
  real(
    'sha256:0cf91eb9ab9368559efefc89d1305c388bdefb9304d675861c088fb5c29f2516',
    '2026-10-25T23:17:37.845Z',
    'wait.ended',
    { waitId: 'open-approval:89341459-1f7e-4183-a61b-60845382f900', result: 'accepted' },
  ),
  real(
    'b6820935faa94722948c5a91faad4b0dc9d7132c99dce3e96fe03a91e6cce635',
    '2026-10-25T23:19:54.728Z',
    'change.lifecycle.transitioned',
    transition('design', 'build', 'running'),
  ),
  real(
    '6c5be295a06f6fb2f07af4950e69f68e81828b80d60b021a29e8059b7a368e83',
    '2026-10-25T23:22:31.230Z',
    'change.lifecycle.transitioned',
    transition('build', 'verify', 'running'),
  ),
  real(
    'b739376ca9a5ba54bda8cf93f09388f63368d192fe7dc1e16d5daae602abd964',
    '2026-10-25T23:29:14.012Z',
    'change.lifecycle.transitioned',
    transition('verify', 'archive', 'running'),
  ),
  real(
    '05f628881ad4d2cf310dee67772e3df20fa79f588711cc2f44c74298d2395de3',
    '2026-10-26T00:37:13.802Z',
    'change.lifecycle.transitioned',
    transition(
      'archive',
      'design',
      'running',
      `${REAL_SOURCE.runId}:specification.plan:48b34c9fb4e7c874`,
      'specification.plan',
    ),
  ),
]);

const currentWork = 'build:2.8:81f58e669d08';
const currentTask = Object.freeze({ id: '2.8', revision: `sha256:${'a'.repeat(64)}` });
const executionContext = Object.freeze({
  phase: 'build',
  work: { id: currentWork, kind: 'task.implement' },
  attempt: 1,
  task: currentTask,
});

const SYNTHETIC_CONTRACT_AND_FAULT_SUPPLEMENT: readonly CoverageObservationRecord[] =
  Object.freeze([
    synthetic(1, 'change.lifecycle.transitioned', transition('design', 'build', 'running')),
    synthetic(2, 'work.created', {
      phase: 'build',
      workId: currentWork,
      workKind: 'task.implement',
    }),
    synthetic(3, 'work.claimed', {
      phase: 'build',
      workId: currentWork,
      workKind: 'task.implement',
      attempt: 1,
    }),
    synthetic(4, 'task.started', {
      executionContext: {
        ...executionContext,
        task: { id: '2.7', revision: `sha256:${'b'.repeat(64)}` },
      },
    }),
    synthetic(5, 'task.completed', {
      executionContext: {
        ...executionContext,
        task: { id: '2.7', revision: `sha256:${'b'.repeat(64)}` },
      },
    }),
    synthetic(6, 'task.reopened', {
      executionContext: {
        ...executionContext,
        task: { id: '2.7', revision: `sha256:${'b'.repeat(64)}` },
      },
    }),
    synthetic(7, 'skill.resolved', {
      executionContext,
      skillName: 'repoctopus-build-task',
      skillRole: 'action',
    }),
    synthetic(8, 'skill.delivered', {
      executionContext,
      skillName: 'repoctopus-build-task',
      skillRole: 'action',
    }),
    synthetic(9, 'skill.consumed', {
      executionContext,
      skillName: 'repoctopus-build-task',
      skillRole: 'action',
    }),
    synthetic(10, 'skill.resolved', {
      executionContext,
      skillName: 'tdd',
      skillRole: 'augmentation',
    }),
    synthetic(11, 'skill.delivered', {
      executionContext,
      skillName: 'tdd',
      skillRole: 'augmentation',
    }),
    synthetic(12, 'skill.consumed', {
      executionContext,
      skillName: 'tdd',
      skillRole: 'augmentation',
    }),
    synthetic(13, 'decision.requested', {
      phase: 'design',
      decisionId: 'design-approval-1',
      result: 'requested',
    }),
    synthetic(14, 'decision.resolved', {
      phase: 'design',
      decisionId: 'design-approval-1',
      result: 'accepted',
    }),
    synthetic(15, 'validator.started', {
      executionContext,
      operationId: 'validator-operation-1',
    }),
    synthetic(16, 'tool.observation-reported', {
      executionContext,
      invocationId: 'invocation-1',
      observationStatus: 'observed',
    }),
    synthetic(17, 'tool.usage-reported', {
      executionContext,
      invocationId: 'invocation-1',
      toolCategory: 'test.run',
      result: 'succeeded',
    }),
    synthetic(18, 'evidence.attempt.started', {
      phase: 'verify',
      attemptId: 'evidence-attempt-1',
    }),
    synthetic(19, 'evidence.attempt.completed', {
      phase: 'verify',
      attemptId: 'evidence-attempt-1',
      result: 'failed',
    }),
    synthetic(20, 'evidence.gate.evaluated', {
      phase: 'verify',
      result: 'rejected',
    }),
    synthetic(21, 'recovery.reconciled', {
      phase: 'build',
      recoveryKind: 'resume',
      result: 'succeeded',
    }),
    synthetic(22, 'telemetry.delivery-started', {
      destinationKind: 'remote',
      operationId: 'delivery-1',
    }),
    synthetic(23, 'telemetry.delivery-completed', {
      destinationKind: 'remote',
      operationId: 'delivery-1',
      result: 'failed',
    }),
    synthetic(24, 'telemetry.receiver-evaluated', {
      destinationKind: 'desktop',
      result: 'accepted',
    }),
    synthetic(25, 'telemetry.gap-recorded', {
      destinationKind: 'remote',
      result: 'dropped',
    }),
    synthetic(26, 'task.started', { executionContext }),
  ]);

const FIXTURE = Object.freeze([
  ...REAL_SELF_BOOTSTRAP_SLICE,
  ...SYNTHETIC_CONTRACT_AND_FAULT_SUPPLEMENT,
]);

function eventHasPhase(event: CoverageObservationRecord, phase: string): boolean {
  const context = event.data.executionContext as Record<string, unknown> | undefined;
  const transitionData = event.data.changeLifecycleTransition as
    | Record<string, Record<string, unknown>>
    | undefined;
  return (
    event.data.phase === phase ||
    context?.phase === phase ||
    transitionData?.from?.phase === phase ||
    transitionData?.to?.phase === phase
  );
}

const omissions: Record<
  ObservationCoverageRequirement,
  (event: CoverageObservationRecord) => boolean
> = {
  'run-boundary': (event) => event.type !== 'run.started',
  'phase-open': (event) => !eventHasPhase(event, 'open'),
  'phase-design': (event) => !eventHasPhase(event, 'design'),
  'phase-build': (event) => !eventHasPhase(event, 'build'),
  'phase-verify': (event) => !eventHasPhase(event, 'verify'),
  'phase-archive': (event) => !eventHasPhase(event, 'archive'),
  'work-lifecycle': (event) => event.type !== 'work.created',
  'task-lifecycle': (event) => event.type !== 'task.reopened',
  'skill-chain': (event) => event.type !== 'skill.consumed',
  'decision-boundary': (event) => event.type !== 'decision.requested',
  'wait-boundary': (event) => event.type !== 'wait.started',
  'tool-observation': (event) => event.type !== 'tool.observation-reported',
  'validator-boundary': (event) => event.type !== 'validator.started',
  'evidence-boundary-and-gate': (event) => event.type !== 'evidence.gate.evaluated',
  continuation: (event) => event.type !== 'continuation.selected',
  rework: (event) =>
    event.type !== 'task.reopened' &&
    event.eventId !== '05f628881ad4d2cf310dee67772e3df20fa79f588711cc2f44c74298d2395de3',
  recovery: (event) => event.type !== 'recovery.reconciled',
  'telemetry-pipeline-health': (event) => event.type !== 'telemetry.gap-recorded',
};

describe('observation-only telemetry coverage report', () => {
  it('reconstructs the five phases and current execution exclusively from observation records', () => {
    const report = createObservationCoverageReport([...FIXTURE].reverse());

    expect(REAL_SOURCE).toEqual({
      runId: 'change-repoctopus-adopt-comet-single-run-lifecycle-1784ada21df4159c',
      trajectorySha256: 'a17d39d2025e0f6235702652b2924e7c0a54789adca426ac04ec2671d2fdcd5b',
    });
    expect(report.status).toBe('complete');
    expect(report.missing).toEqual([]);
    expect(report.covered).toEqual(OBSERVATION_COVERAGE_REQUIREMENTS);
    expect(report.projection).toMatchObject({
      phasesSeen: ['open', 'design', 'build', 'verify', 'archive'],
      currentPhase: 'build',
      currentStatus: 'running',
      currentWork: { id: currentWork, kind: 'task.implement', attempt: 1 },
      currentTask: { ...currentTask, status: 'started' },
      currentSkills: [
        { name: 'repoctopus-build-task', role: 'action', status: 'consumed' },
        { name: 'tdd', role: 'augmentation', status: 'consumed' },
      ],
      decisionCount: 1,
      evidenceAttemptCount: 1,
      evidenceGateCount: 1,
      reworkCount: 2,
      recoveryCount: 1,
      telemetryHealthFactCount: 4,
    });
    expect(() => assertCompleteObservationCoverage(report)).not.toThrow();
  });

  it('deduplicates replayed records by event identity', () => {
    const report = createObservationCoverageReport([...FIXTURE, FIXTURE[0]!]);
    expect(report.eventCount).toBe(FIXTURE.length);
    expect(report.status).toBe('complete');
  });

  it.each(OBSERVATION_COVERAGE_REQUIREMENTS)(
    'fails the report when required coverage %s is absent',
    (requirement) => {
      const report = createObservationCoverageReport(FIXTURE.filter(omissions[requirement]));
      expect(report.status).toBe('incomplete');
      expect(report.missing).toContain(requirement);
      expect(() => assertCompleteObservationCoverage(report)).toThrow(
        `Observation coverage is incomplete: ${report.missing.join(', ')}`,
      );
    },
  );
});
