import { describe, expect, it } from 'vitest';

import {
  createArchiveDeliveryInput,
  createArchiveDeliveryWork,
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
