import { describe, expect, it } from 'vitest';

import {
  createArchiveDeliveryInput,
  createArchiveDeliveryWork,
  createAwaitMergeWork,
  createPostMergeVerifyWork,
} from '../domains/change-lifecycle/archive-input.js';
import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION, createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { evolveChangeLifecycle } from '../domains/change-lifecycle/transition.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: { automatic: false, protectedBranches: ['main'], commitMessagePattern: '.+', quickChecks: {} },
  publication: {
    remote: 'origin',
    provider: 'github',
    githubApiBaseUrl: 'https://api.github.com',
    mrTitleTemplate: '{{changeId}}',
    mrBodyTemplate: '{{verificationReport}}',
  },
};
const intent: DeliveryIntentV3 = {
  schemaVersion: 3,
  changeId: 'archive-plan',
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'team/workspace',
    sourceBranch: 'spec/archive-plan',
    targetBranch: 'main',
    remoteOid: 'a'.repeat(40),
  },
  businessDeliveries: [
    {
      deliveryId: 'primary',
      repositoryId: 'app',
      sourceBranch: 'feature/archive-plan',
      targetBranch: 'main',
      commitMessage: 'feat: archive plan',
      actions: ['push', 'merge_request'],
    },
  ],
};
const skill: SkillUsageSnapshot = {
  schemaVersion: 1,
  name: 'pr',
  provider: 'matt-builtins',
  invocation: { modelInvocable: true, userInvocable: true },
  contentDigest: digest('a'),
  resourceManifestDigest: digest('b'),
};
const reviewSkill: SkillUsageSnapshot = { ...skill, name: 'code-review' };

describe('Archive Delivery input', () => {
  it('freezes the complete MR set and uses policy authorization without a second approval', () => {
    const archive = createArchiveDeliveryInput({
      runId: 'run-archive',
      changeId: 'archive-plan',
      verificationInputDigest: digest('v'),
      acceptedEvidenceBundleIds: ['bundle-1'],
      evidenceBundleId: 'bundle-1',
      verificationReport: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'ArtifactRef',
        sha256: 'c'.repeat(64),
        size: 128,
        mediaType: 'application/json',
        artifactType: 'verification-report',
        redacted: true,
      },
      intent,
      policy,
    });
    expect(archive).toMatchObject({
      actionAuthorization: 'policy',
      businessDeliveries: [{ deliveryId: 'primary', repositoryId: 'app' }],
      businessSplitReason: null,
      evidenceBundleId: 'bundle-1',
    });
    expect(archive).not.toHaveProperty('approval');
    const work = createArchiveDeliveryWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      archive,
      actionSkill: skill,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace', 'app'],
    });
    const current = {
      ...createChangeLifecycleSnapshot({
        identity: { workspaceId: 'team', changeId: 'archive-plan', generation: 1, runId: 'run-archive' },
      }),
      phase: 'archive' as const,
      status: 'running' as const,
    };
    const planned = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current,
      observation: { kind: 'archive-delivery-ready', archiveInput: archive, work },
    });
    expect(planned.snapshot).toMatchObject({
      phase: 'archive',
      currentWork: { kind: 'delivery.prepare', inputDigest: archive.digest },
      archiveDeliveryInput: { digest: archive.digest },
    });
    const publication = {
      snapshot: {
        schemaVersion: 3 as const,
        changeId: 'archive-plan',
        compositionDigest: digest('o'),
        digest: digest('d'),
        reportDigest: digest('r'),
        policyDigest: archive.publicationPolicyDigest,
        intentDigest: digest('i'),
        evidenceBundleIds: ['bundle-1'],
        changeBranch: archive.changeBranch,
        businessDeliveries: [],
        businessSplitReason: null,
        plan: [],
        createdAt: '2026-10-24T00:00:00.000Z',
      },
      receipts: [
        {
          actionId: 'push-1',
          deliveryId: 'primary',
          type: 'git.push' as const,
          status: 'succeeded' as const,
          recovered: false,
          remoteOid: 'd'.repeat(40),
        },
        {
          actionId: 'mr-1',
          deliveryId: 'primary',
          type: 'mr.create_or_update' as const,
          status: 'succeeded' as const,
          recovered: false,
          mergeRequest: {
            provider: 'github',
            repositoryId: 'app',
            number: 1,
            url: 'https://github.com/team/app/pull/1',
          },
        },
      ],
    };
    const waitWork = createAwaitMergeWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      archive,
      publication,
      workspaceRepositoryId: 'workspace',
      repositoryIds: ['workspace', 'app'],
    });
    const waiting = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: planned.snapshot,
      observation: {
        kind: 'archive-publication-completed',
        archiveInputDigest: archive.digest,
        actionReceiptId: 'action-receipt-1',
        publication,
        work: waitWork,
      },
    });
    expect(waiting.snapshot).toMatchObject({
      phase: 'archive',
      status: 'waiting',
      currentWork: { kind: 'delivery.await-merge' },
      waitCondition: { kind: 'platform-event', eventType: 'business-merge-request.updated' },
      archivePublication: { receipts: [{ type: 'git.push' }, { type: 'mr.create_or_update' }] },
    });
    const pending = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: waiting.snapshot,
      observation: {
        kind: 'archive-merge-refreshed',
        source: 'webhook',
        refresh: {
          allMerged: false,
          mergeRequestStatuses: [
            {
              provider: 'github',
              repositoryId: 'app',
              number: 1,
              url: 'https://github.com/team/app/pull/1',
              state: 'open',
              ci: 'passed',
              review: 'approved',
              conversationsResolved: true,
              mergeCommit: null,
              mergedAt: null,
            },
          ],
          mergeEvidence: [],
          platformCapabilities: [],
        },
      },
    });
    expect(pending.snapshot).toMatchObject({
      status: 'waiting',
      archiveMerge: { source: 'webhook', allMerged: false },
    });
    const mergedRefresh = {
      allMerged: true,
      mergeRequestStatuses: [
        {
          provider: 'github',
          repositoryId: 'app',
          number: 1,
          url: 'https://github.com/team/app/pull/1',
          state: 'merged' as const,
          ci: 'passed' as const,
          review: 'approved' as const,
          conversationsResolved: true,
          mergeCommit: 'e'.repeat(40),
          mergedAt: '2026-10-24T00:00:00.000Z',
        },
      ],
      mergeEvidence: [
        {
          deliveryId: 'primary',
          repositoryId: 'app',
          mergeRequest: {
            provider: 'github',
            repositoryId: 'app',
            number: 1,
            url: 'https://github.com/team/app/pull/1',
          },
          mergeCommit: 'e'.repeat(40),
          mergedAt: '2026-10-24T00:00:00.000Z',
          observedAt: '2026-10-24T00:01:00.000Z',
        },
      ],
      platformCapabilities: [],
    };
    const merged = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: pending.snapshot,
      observation: {
        kind: 'archive-merge-refreshed',
        source: 'run-start',
        refresh: mergedRefresh,
        work: createPostMergeVerifyWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          archive,
          refresh: mergedRefresh,
          actionSkill: reviewSkill,
          workspaceRepositoryId: 'workspace',
          repositoryIds: ['workspace', 'app'],
        }),
      },
    });
    expect(merged.snapshot).toMatchObject({
      phase: 'archive',
      status: 'running',
      currentWork: { kind: 'delivery.verify-merged' },
      waitCondition: null,
      archiveMerge: { source: 'run-start', allMerged: true },
    });
    const postMergeVerified = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: merged.snapshot,
      observation: {
        kind: 'archive-post-merge-verified',
        result: 'satisfied',
        workId: merged.snapshot.currentWork!.workId,
        inputDigest: merged.snapshot.currentWork!.inputDigest,
        attemptId: 'attempt-post-merge',
        bundleId: 'bundle-post-merge',
        checkoutManifestDigest: digest('m'),
        evidenceInputFingerprint: 'fingerprint-post-merge',
        workflowStateVersion: 12,
      },
    });
    expect(postMergeVerified.snapshot).toMatchObject({
      phase: 'archive',
      status: 'running',
      currentWork: null,
      postMergeVerification: {
        status: 'satisfied',
        attemptId: 'attempt-post-merge',
        bundleId: 'bundle-post-merge',
      },
    });
  });

  it('requires a split reason for multiple Business merge requests and accepted Evidence', () => {
    expect(() =>
      createArchiveDeliveryInput({
        runId: 'run-archive',
        changeId: 'archive-plan',
        verificationInputDigest: digest('v'),
        acceptedEvidenceBundleIds: [],
        evidenceBundleId: 'bundle-1',
        verificationReport: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'ArtifactRef',
          sha256: 'c'.repeat(64),
          size: 128,
          mediaType: 'application/json',
          artifactType: 'verification-report',
          redacted: true,
        },
        intent,
        policy,
      }),
    ).toThrow(/accepted by the Change Run/u);
    expect(() =>
      createArchiveDeliveryInput({
        runId: 'run-archive',
        changeId: 'archive-plan',
        verificationInputDigest: digest('v'),
        acceptedEvidenceBundleIds: ['bundle-1'],
        evidenceBundleId: 'bundle-1',
        verificationReport: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'ArtifactRef',
          sha256: 'c'.repeat(64),
          size: 128,
          mediaType: 'application/json',
          artifactType: 'verification-report',
          redacted: true,
        },
        intent: {
          ...intent,
          businessDeliveries: [
            ...intent.businessDeliveries,
            { ...intent.businessDeliveries[0]!, deliveryId: 'second', sourceBranch: 'feature/second' },
          ],
        },
        policy,
      }),
    ).toThrow(/split reason/u);
  });
});
