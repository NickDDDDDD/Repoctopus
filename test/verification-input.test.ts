import { describe, expect, it } from 'vitest';

import { createVerificationInput } from '../domains/change-lifecycle/verification-input.js';
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
