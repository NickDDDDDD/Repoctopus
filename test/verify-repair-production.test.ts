import { describe, expect, it, vi } from 'vitest';
import { WorkflowRuns } from '../services/workflow-runs.js';
import type { RunState } from '../domains/engine/types.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import { repairDigest as sha, verifyRepairFixture } from './helpers/verify-repair-fixture.js';
import { createVerificationInput } from '../domains/change-lifecycle/verification-input.js';
import type { EvidenceExecutionPlan } from '../domains/feedback/profile.js';

describe('production Verify implementation failure continuation', () => {
  it('records an unavailable scope as bounded reobservation of the original failed Attempt', async () => {
    const f = verifyRepairFixture();
    const plan: EvidenceExecutionPlan = {
      schemaVersion: 1,
      profileId: 'verify',
      configDigest: sha('config'),
      order: ['check'],
      nodes: [
        {
          id: 'check',
          type: 'command',
          repository: 'workspace',
          repositoryPath: '.',
          required: true,
          covers: ['*'],
          dependsOn: [],
          executable: 'node',
          args: [],
          timeoutMs: 1000,
          cache: false,
          zeroTests: 'blocking',
        },
      ],
    };
    const verification = createVerificationInput({
      runId: f.runId,
      checkEpoch: 9,
      tasks: f.tasks.tasks.map((t) => ({ ...t, status: 'completed' })),
      plan,
      fingerprint: {
        algorithm: 'sha256',
        digest: 'fingerprint',
        manifest: {
          schemaVersion: 3,
          profileId: 'verify',
          sharedConfigDigest: sha('config'),
          localConfigDigest: null,
          repositories: [
            {
              repositoryId: 'workspace',
              head: 'a'.repeat(40),
              tree: 'b'.repeat(40),
              dirtyFiles: [],
              inputPolicyDigest: sha('policy'),
              controlPlane: { digest: sha('control'), files: [] },
            },
          ],
          nodeInputs: [],
          planningProjection: null,
          tools: {},
          adapters: {},
          inputArtifactDigests: [],
        },
      },
      projectConfigDigest: sha('config'),
      compositionDigest: sha('composition'),
      skills: [
        {
          schemaVersion: 1,
          name: 'repoctopus-verify-change',
          provider: 'test',
          invocation: { modelInvocable: true, userInvocable: false },
          contentDigest: sha('skill'),
          resourceManifestDigest: sha('resources'),
        },
      ],
    });
    const work = {
      workId: 'verify-work',
      kind: 'evidence.verify',
      checkEpoch: 9,
      inputDigest: verification.digest,
      validatorProfile: { id: 'verify-validator' },
    };
    const lifecycle = {
      phase: 'verify',
      status: 'running',
      checkEpoch: 9,
      currentWork: work,
      verificationInput: verification,
      buildProtocol: f.protocol,
    };
    const state = {
      runId: f.runId,
      status: 'running',
      changeLifecycle: lifecycle,
      workExecution: {
        workId: work.workId,
        checkEpoch: 9,
        inputDigest: verification.digest,
        attempt: 1,
        status: 'validated',
        validatorId: 'verify-validator',
        receiptId: 'review-receipt',
        actionOutcome: { status: 'succeeded' },
      },
    } as unknown as RunState;
    const recordContinuation = vi.fn();
    const gate = {
      schemaVersion: 3,
      workflowRunId: f.runId,
      workflowActionId: work.workId,
      workflowStepId: 'verify',
      checkEpoch: 9,
      profileId: 'verify',
      compositionDigest: sha('composition'),
      inputFingerprint: 'fingerprint',
      verificationInputDigest: verification.digest,
      acceptanceSetHash: verification.acceptanceSetHash,
      status: 'blocked',
      failureKind: 'implementation',
      bundleId: 'failed-bundle',
      reason: 'implementation failed',
    };
    const runOrResume = vi
      .fn()
      .mockResolvedValue({ bundle: { bundleId: 'failed-bundle', findings: [] } });
    const service = Object.create(WorkflowRuns.prototype) as WorkflowRuns;
    Object.defineProperties(service, {
      operations: {
        value: { run: (_options: unknown, operation: () => Promise<unknown>) => operation() },
      },
      recoverEvidenceWorkspace: { value: vi.fn() },
      createVerifyFailureContinuation: {
        value: vi
          .fn()
          .mockRejectedValue(new Error('Verify repair scope unavailable: unowned finding')),
      },
      coordinator: { value: { status: vi.fn().mockResolvedValue({ state }) } },
      ctx: {
        value: {
          runStore: { loadRun: vi.fn().mockResolvedValue(state) },
          workExecutionAuthority: { recordContinuation },
          evidenceCoordinator: {
            unsettledWorkAttemptIds: vi.fn().mockResolvedValue([]),
            runOrResume,
            evaluate: vi.fn().mockResolvedValue(gate),
          },
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      const response = await service.verifyChange({
        runId: f.runId,
        attemptId: 'original-attempt',
      });
      expect(response.value).toMatchObject({
        attemptId: 'original-attempt',
        bundleId: 'failed-bundle',
        gate: 'blocked',
        run: { continuation: { continuation: 'reobserve' } },
      });
    }
    expect(recordContinuation).toHaveBeenCalledTimes(2);
    expect(runOrResume.mock.calls.map((c) => c[1] as unknown)).toEqual([
      'original-attempt',
      'original-attempt',
    ]);
    expect(state.changeLifecycle!.buildProtocol!.packageCompletions).toEqual(
      f.protocol.packageCompletions,
    );
  });
  it('invalidates only the failed package instead of all four completed packages', async () => {
    const fixture = verifyRepairFixture();
    const state = {
      runId: fixture.runId,
      composition: { compositionDigest: sha('composition') },
      projectSnapshotDigest: sha('snapshot'),
      trigger: {
        facts: {
          projectConfigDigest: sha('config'),
          specificationRoot: { repositoryId: 'workspace' },
        },
      },
      changeLifecycle: {
        phase: 'verify',
        checkEpoch: 9,
        planningDigest: fixture.tasks.digest,
        tasks: fixture.tasks.tasks,
        verificationInput: { digest: sha('verify') },
        buildProtocol: fixture.protocol,
      },
    } as unknown as RunState;
    const skill: SkillUsageSnapshot = {
      schemaVersion: 1,
      name: 'repoctopus-build-plan',
      provider: 'test',
      invocation: { modelInvocable: true, userInvocable: false },
      contentDigest: sha('skill'),
      resourceManifestDigest: sha('resources'),
    };
    const service = Object.create(WorkflowRuns.prototype) as WorkflowRuns;
    Object.defineProperties(service, {
      ctx: {
        value: {
          runStore: {
            loadProjectSnapshot: vi.fn().mockResolvedValue({ repositories: [{ id: 'workspace' }] }),
          },
          evidenceCoordinator: {
            verifyRepairFacts: vi.fn().mockResolvedValue({
              failedNodeIds: ['check-a'],
              failedAcceptanceIds: fixture.plan.packages[0]!.acceptanceRefs,
              retained: fixture.protocol.packageCompletions.slice(1).map((c) => ({
                completionId: c.completionId,
                packageId: c.packageId,
                packageDigest: c.packageDigest,
                receiptIds: [`receipt-${c.packageId}`],
              })),
              affectedPackageIds: [fixture.plan.packages[0]!.packageId],
              attemptId: 'failed-attempt',
              bundleId: 'failed-bundle',
            }),
          },
        },
      },
      coordinator: { value: { bindSkill: vi.fn() } },
      resolveLifecycleWorkSkills: {
        value: vi.fn().mockResolvedValue({ actionSkill: skill, augmentationSkills: [] }),
      },
    });
    const continuation = await (
      service as unknown as {
        createVerifyFailureContinuation(
          state: RunState,
          result: string,
          signal?: AbortSignal,
          attemptId?: string,
        ): Promise<{
          invalidation: { affectedPackageIds: string[]; retainedCompletionIds: string[] };
        }>;
      }
    ).createVerifyFailureContinuation(state, 'implementation-failure', undefined, 'failed-attempt');
    expect(continuation.invalidation.affectedPackageIds).toEqual([
      fixture.plan.packages[0]!.packageId,
    ]);
    expect(continuation.invalidation.retainedCompletionIds).toEqual(
      fixture.protocol.packageCompletions
        .slice(1)
        .map((c) => c.completionId)
        .sort(),
    );
  });
});
