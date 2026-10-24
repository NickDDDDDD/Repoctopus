import { describe, expect, it } from 'vitest';

import { createVerificationInput } from '../domains/change-lifecycle/verification-input.js';
import { acceptVerifyGate, rejectVerifyGate } from '../domains/change-lifecycle/verify-gate.js';
import { createVerifyWork } from '../domains/change-lifecycle/verify-work.js';
import type { EvidenceGateProjection } from '../domains/evidence/types.js';
import { evolveChangeLifecycle } from '../domains/change-lifecycle/transition.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import type { EvidenceFingerprint } from '../domains/evidence/fingerprint.js';
import type { EvidenceExecutionPlan } from '../domains/feedback/profile.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const tasks = parseSpecificationTasks('verify-input', '- [x] 1.1 Build it.\n').tasks;
const skill: SkillUsageSnapshot = {
  schemaVersion: 1,
  name: 'tdd',
  provider: 'matt-builtins',
  invocation: { modelInvocable: true, userInvocable: true },
  contentDigest: digest('s'),
  resourceManifestDigest: digest('r'),
};
const reviewSkill: SkillUsageSnapshot = { ...skill, name: 'code-review' };
const plan: EvidenceExecutionPlan = {
  schemaVersion: 1,
  profileId: 'verify',
  configDigest: digest('p'),
  nodes: [
    {
      id: 'test',
      type: 'command',
      repository: 'workspace',
      repositoryPath: '.',
      required: true,
      dependsOn: [],
      executable: 'npm',
      args: ['test'],
      cwd: '.',
      timeoutMs: 60_000,
      cache: false,
      zeroTests: 'blocking',
    },
  ],
  order: ['test'],
};
const fingerprint: EvidenceFingerprint = {
  algorithm: 'sha256',
  digest: 'fingerprint-1',
  manifest: {
    schemaVersion: 1,
    profileId: 'verify',
    sharedConfigDigest: 'shared-1',
    localConfigDigest: null,
    repositories: [
      {
        repositoryId: 'workspace',
        head: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        dirtyFiles: [],
      },
    ],
    tools: {},
    adapters: {},
    inputArtifactDigests: [],
  },
};

function create(overrides: Partial<Parameters<typeof createVerificationInput>[0]> = {}) {
  return createVerificationInput({
    runId: 'run-1',
    tasks,
    fingerprint,
    plan,
    projectConfigDigest: digest('c'),
    compositionDigest: digest('o'),
    skills: [skill],
    ...overrides,
  });

  it('appends a Verify invalidation, preserves Evidence identity, and returns to Build', () => {
    const verification = create();
    const work = createVerifyWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      verification,
      actionSkill: reviewSkill,
      augmentationSkills: [],
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
    });
    const lifecycle = {
      ...createChangeLifecycleSnapshot({
        identity: { workspaceId: 'team', changeId: 'verify-input', generation: 1, runId: 'run-1' },
      }),
      phase: 'verify' as const,
      status: 'running' as const,
      currentWork: work,
      tasks,
      planningDigest: digest('p'),
      verificationInput: verification,
    };
    const rejected = rejectVerifyGate({
      runId: 'run-1',
      lifecycle,
      attemptId: 'attempt-failed',
      workflowStateVersion: 9,
      gate: {
        schemaVersion: 1,
        kind: 'EvidenceGateProjection',
        workflowRunId: 'run-1',
        workflowActionId: work.workId,
        workflowStepId: 'verify',
        workflowStateVersion: 9,
        compositionDigest: verification.compositionDigest,
        profileId: 'verify',
        bundleId: 'bundle-failed',
        inputFingerprint: verification.evidenceProfile.fingerprintDigest,
        outcome: 'failed',
        status: 'blocked',
        reason: 'required test failed',
      },
    });
    const fallback = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: lifecycle,
      observation: { kind: 'verify-gate-rejected', ...rejected },
    });
    expect(fallback.snapshot).toMatchObject({
      phase: 'build',
      status: 'running',
      currentWork: null,
      verificationInvalidation: {
        kind: 'evidence-gate-blocked',
        priorInputDigest: verification.digest,
        attemptId: 'attempt-failed',
        bundleId: 'bundle-failed',
      },
    });
    expect(fallback.snapshot.verificationInput).toBeUndefined();
    expect(fallback.fact?.transitionId).toBe('verify.failed');
  });
}

describe('Verification input', () => {
  it('freezes Task, repository, configuration, composition, Skill, and Evidence identities', () => {
    const input = create();
    expect(input).toMatchObject({
      taskRevisions: [{ taskId: '1.1', taskRevision: tasks[0]!.taskRevision }],
      repositories: [
        { repositoryId: 'workspace', commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
      ],
      projectConfigDigest: digest('c'),
      compositionDigest: digest('o'),
      skills: [{ name: 'tdd', provider: 'matt-builtins' }],
      evidenceProfile: { id: 'verify', fingerprintDigest: 'fingerprint-1' },
    });
    expect(input.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(create().digest).toBe(input.digest);
  });

  it('accepts only a satisfied Gate bound to the same Run, Work, state, and input', () => {
    const verification = create();
    const work = createVerifyWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      verification,
      actionSkill: reviewSkill,
      augmentationSkills: [],
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
    });
    const lifecycle = {
      ...createChangeLifecycleSnapshot({
        identity: { workspaceId: 'team', changeId: 'verify-input', generation: 1, runId: 'run-1' },
      }),
      phase: 'verify' as const,
      status: 'running' as const,
      currentWork: work,
      tasks,
      planningDigest: digest('p'),
      verificationInput: verification,
    };
    const gate: EvidenceGateProjection = {
      schemaVersion: 1,
      kind: 'EvidenceGateProjection',
      workflowRunId: 'run-1',
      workflowActionId: work.workId,
      workflowStepId: 'verify',
      workflowStateVersion: 7,
      compositionDigest: verification.compositionDigest,
      profileId: 'verify',
      bundleId: 'bundle-1',
      inputFingerprint: verification.evidenceProfile.fingerprintDigest,
      outcome: 'passed',
      status: 'satisfied',
      reason: 'passed',
    };
    const accepted = acceptVerifyGate({
      runId: 'run-1',
      lifecycle,
      gate,
      attemptId: 'attempt-1',
      workflowStateVersion: 7,
    });
    expect(accepted).toMatchObject({
      runId: 'run-1',
      workId: work.workId,
      inputDigest: verification.digest,
      bundleId: 'bundle-1',
    });
    const archived = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: lifecycle,
      observation: { kind: 'verify-gate-satisfied', ...accepted },
    });
    expect(archived.snapshot).toMatchObject({ phase: 'archive', status: 'running' });

    expect(() =>
      acceptVerifyGate({
        runId: 'run-1',
        lifecycle,
        gate: { ...gate, workflowStateVersion: 6 },
        attemptId: 'attempt-old',
        workflowStateVersion: 7,
      }),
    ).toThrow(/stale workflow state/u);
    expect(() =>
      acceptVerifyGate({
        runId: 'run-1',
        lifecycle,
        gate: { ...gate, workflowRunId: 'run-2' },
        attemptId: 'attempt-other-run',
        workflowStateVersion: 7,
      }),
    ).toThrow(/another workflow run/u);
    expect(() =>
      acceptVerifyGate({
        runId: 'run-1',
        lifecycle,
        gate: { ...gate, inputFingerprint: 'fingerprint-old' },
        attemptId: 'attempt-old-input',
        workflowStateVersion: 7,
      }),
    ).toThrow(/stale verification inputs/u);
  });

  it('fails closed when any required verification identity is missing or mismatched', () => {
    const pending = parseSpecificationTasks('verify-input', '- [ ] 1.1 Build it.\n').tasks;
    expect(() => create({ tasks: pending })).toThrow(/every approved Task/u);
    expect(() =>
      create({ fingerprint: { ...fingerprint, manifest: { ...fingerprint.manifest, repositories: [] } } }),
    ).toThrow(/repository fingerprint/u);
    expect(() => create({ skills: [] })).toThrow(/bound Skills/u);
    expect(() => create({ plan: { ...plan, nodes: [], order: [] } })).toThrow(/has no nodes/u);
    expect(() =>
      create({
        fingerprint: {
          ...fingerprint,
          manifest: { ...fingerprint.manifest, profileId: 'other' },
        },
      }),
    ).toThrow(/do not match/u);
  });

  it('keeps the Change in build/blocked when verification input preparation is incomplete', () => {
    const opened = createChangeLifecycleSnapshot({
      identity: { workspaceId: 'team', changeId: 'verify-input', generation: 1, runId: 'run-1' },
    });
    const current = {
      ...opened,
      phase: 'build' as const,
      status: 'running' as const,
      tasks,
      planningDigest: digest('p'),
    };
    const blocked = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      observation: {
        kind: 'build-verification-blocked',
        reason: 'Verification Evidence Profile has no nodes: verify',
        evidenceIds: [],
      },
    });
    expect(blocked.snapshot).toMatchObject({
      phase: 'build',
      status: 'blocked',
      currentWork: null,
      blocker: { code: 'build.verification-input-incomplete' },
    });
  });
});
