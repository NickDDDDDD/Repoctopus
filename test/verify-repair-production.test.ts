import { describe, expect, it, vi } from 'vitest';
import { WorkflowRuns } from '../services/workflow-runs.js';
import type { RunState } from '../domains/engine/types.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import { repairDigest as sha, verifyRepairFixture } from './helpers/verify-repair-fixture.js';

describe('production Verify implementation failure continuation', () => {
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
              retained: fixture.protocol.packageCompletions
                .slice(1)
                .map((c) => ({
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
