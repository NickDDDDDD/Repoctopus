import { evidenceNodeInputFixture, evidenceDependencyFixture } from './helpers/evidence-inputs.js';
import { describe, expect, it } from 'vitest';

import { createVerificationInput } from '../domains/change-lifecycle/verification-input.js';
import { acceptVerifyGate } from '../domains/change-lifecycle/verify-gate.js';
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
const tasks = parseSpecificationTasks(
  'verify-input',
  '- [x] 1.1 Build it.\n  **Acceptance:** The implementation works\n  **Requirements:** runtime#works\n',
).tasks;
const skill: SkillUsageSnapshot = {
  schemaVersion: 1,
  name: 'tdd',
  provider: 'matt-builtins',
  invocation: { modelInvocable: true, userInvocable: true },
  contentDigest: digest('s'),
  resourceManifestDigest: digest('r'),
};
const reviewSkill: SkillUsageSnapshot = { ...skill, name: 'code-review' };
const verifySkill: SkillUsageSnapshot = { ...skill, name: 'repoctopus-verify-change' };
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
      covers: ['*'],
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
    schemaVersion: 3,
    profileId: 'verify',
    sharedConfigDigest: 'shared-1',
    localConfigDigest: null,
    repositories: [
      {
        repositoryId: 'workspace',
        head: 'a'.repeat(40),
        tree: 'b'.repeat(40),
        dirtyFiles: [],
        inputPolicyDigest: digest('1'),
        controlPlane: { digest: digest('2'), files: [] },
      },
    ],
    tools: {},
    adapters: {},
    nodeInputs: [evidenceNodeInputFixture()],
    planningProjection: null,
    inputArtifactDigests: [],
  },
};

function create(overrides: Partial<Parameters<typeof createVerificationInput>[0]> = {}) {
  return createVerificationInput({
    runId: 'run-1',
    checkEpoch: 1,
    tasks,
    fingerprint,
    plan,
    projectConfigDigest: digest('c'),
    compositionDigest: digest('o'),
    skills: [skill],
    ...overrides,
  });
}

describe('Verification input', () => {
  it('invalidates the input when policy or control-plane content changes', () => {
    const original = create();
    const repository = fingerprint.manifest.repositories[0]!;
    const changedPolicy = create({
      fingerprint: {
        ...fingerprint,
        digest: 'fingerprint-policy',
        manifest: {
          ...fingerprint.manifest,
          repositories: [{ ...repository, inputPolicyDigest: digest('3') }],
        },
      },
    });
    const changedControlPlane = create({
      fingerprint: {
        ...fingerprint,
        digest: 'fingerprint-control-plane',
        manifest: {
          ...fingerprint.manifest,
          repositories: [
            {
              ...repository,
              controlPlane: { ...repository.controlPlane, digest: digest('4') },
            },
          ],
        },
      },
    });

    expect(changedPolicy.digest).not.toBe(original.digest);
    expect(changedControlPlane.digest).not.toBe(original.digest);
  });

  it('rejects incomplete repository input policy fingerprints', () => {
    const repository = fingerprint.manifest.repositories[0]!;
    expect(() =>
      create({
        fingerprint: {
          ...fingerprint,
          manifest: {
            ...fingerprint.manifest,
            repositories: [{ ...repository, inputPolicyDigest: 'sha256:invalid' }],
          },
        },
      }),
    ).toThrow(/input policy fingerprint is incomplete/u);
  });

  it('freezes Task, repository, configuration, composition, Skill, and Evidence identities', () => {
    const input = create();
    expect(input).toMatchObject({
      schemaVersion: 4,
      taskRevisions: [{ taskId: '1.1', taskRevision: tasks[0]!.taskRevision }],
      acceptanceCriteria: [
        { taskId: '1.1', text: 'The implementation works', requirementRefs: ['runtime#works'] },
      ],
      acceptanceCoverage: [
        { acceptanceId: tasks[0]!.acceptanceCriteria[0]!.acceptanceId, nodeIds: ['test'] },
      ],
      repositories: [
        {
          repositoryId: 'workspace',
          commit: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          inputPolicyDigest: digest('1'),
          controlPlaneInputDigest: digest('2'),
        },
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
      checkEpoch: verification.checkEpoch,
      verification,
      actionSkill: verifySkill,
      augmentationSkills: [reviewSkill],
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace'],
    });
    const lifecycle = {
      ...createChangeLifecycleSnapshot({
        identity: {
          workspaceId: 'team',
          changeId: 'verify-input',
          runId: 'run-1',
        },
      }),
      phase: 'verify' as const,
      status: 'running' as const,
      checkEpoch: verification.checkEpoch,
      currentWork: work,
      tasks,
      planningDigest: digest('p'),
      verificationInput: verification,
    };
    const gate: EvidenceGateProjection = {
      schemaVersion: 3,
      dependencies: evidenceDependencyFixture('gate', 'gate-fixture'),
      kind: 'EvidenceGateProjection',
      failureKind: 'none',
      workflowRunId: 'run-1',
      workflowActionId: work.workId,
      workflowStepId: 'verify',
      workflowStateVersion: 7,
      checkEpoch: verification.checkEpoch,
      compositionDigest: verification.compositionDigest,
      profileId: 'verify',
      bundleId: 'bundle-1',
      inputFingerprint: verification.evidenceProfile.fingerprintDigest,
      verificationInputDigest: verification.digest,
      acceptanceSetHash: verification.acceptanceSetHash,
      outcome: 'passed',
      status: 'satisfied',
      reason: 'passed',
    };
    const accepted = acceptVerifyGate({
      runId: 'run-1',
      lifecycle,
      gate,
      attemptId: 'attempt-1',
      checkEpoch: verification.checkEpoch,
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
        gate: { ...gate, checkEpoch: 0 },
        attemptId: 'attempt-old',
        checkEpoch: verification.checkEpoch,
      }),
    ).toThrow(/stale checkEpoch/u);
    expect(() =>
      acceptVerifyGate({
        runId: 'run-1',
        lifecycle,
        gate: { ...gate, workflowRunId: 'run-2' },
        attemptId: 'attempt-other-run',
        checkEpoch: verification.checkEpoch,
      }),
    ).toThrow(/another workflow run/u);
    expect(() =>
      acceptVerifyGate({
        runId: 'run-1',
        lifecycle,
        gate: { ...gate, inputFingerprint: 'fingerprint-old' },
        attemptId: 'attempt-old-input',
        checkEpoch: verification.checkEpoch,
      }),
    ).toThrow(/stale verification inputs/u);
    expect(() =>
      acceptVerifyGate({
        runId: 'run-1',
        lifecycle,
        gate: { ...gate, verificationInputDigest: null, acceptanceSetHash: null },
        attemptId: 'attempt-no-trace',
        checkEpoch: verification.checkEpoch,
      }),
    ).toThrow(/matching Acceptance Trace/u);
  });

  it('fails closed when any required verification identity is missing or mismatched', () => {
    const pending = parseSpecificationTasks('verify-input', '- [ ] 1.1 Build it.\n').tasks;
    expect(() => create({ tasks: pending })).toThrow(/every approved Task/u);
    expect(() =>
      create({
        fingerprint: { ...fingerprint, manifest: { ...fingerprint.manifest, repositories: [] } },
      }),
    ).toThrow(/repository fingerprint/u);
    expect(() => create({ skills: [] })).toThrow(/bound Skills/u);
    expect(() => create({ plan: { ...plan, nodes: [], order: [] } })).toThrow(/has no nodes/u);
    expect(() =>
      create({
        plan: {
          ...plan,
          nodes: plan.nodes.map((node) => ({ ...node, covers: [] })),
        },
      }),
    ).toThrow(/does not cover Acceptance/u);
    expect(() =>
      create({
        plan: {
          ...plan,
          nodes: plan.nodes.map((node) => ({ ...node, covers: ['task:9.9'] })),
        },
      }),
    ).toThrow(/unknown Acceptance selector/u);
    expect(() =>
      create({
        plan: {
          ...plan,
          nodes: plan.nodes.map((node) => ({ ...node, required: false, covers: ['*'] })),
        },
      }),
    ).toThrow(/does not cover Acceptance/u);
    expect(() =>
      create({
        fingerprint: {
          ...fingerprint,
          manifest: { ...fingerprint.manifest, profileId: 'other' },
        },
      }),
    ).toThrow(/do not match/u);
  });
});
