import { describe, expect, it, vi } from 'vitest';

import type {
  DeliveryEvidencePort,
  DeliveryGitPort,
  DeliveryV3StorePort,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import { DeliveryServiceV3 } from '../domains/delivery/service-v3.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

const head = 'a'.repeat(40);
const target = 'b'.repeat(40);
const workspace = 'C:/repoctopus-workspace';
const closurePaths = [
  'openspec/changes/archive/2026-10-25-example/proposal.md',
  'openspec/changes/example/proposal.md',
];

const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: {
    automatic: true,
    protectedBranches: ['main'],
    commitMessagePattern: '^feat: .+',
    quickChecks: {},
  },
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
  changeId: 'archive-cleanliness',
  changeBranch: {
    repositoryId: 'workspace',
    remoteIdentity: 'github.com/team/workspace',
    sourceBranch: 'spec/archive-cleanliness',
    targetBranch: 'main',
    remoteOid: head,
  },
  businessDeliveries: [
    {
      deliveryId: 'primary',
      repositoryId: 'workspace',
      sourceBranch: 'spec/archive-cleanliness',
      targetBranch: 'main',
      commitMessage: 'feat: archive cleanliness',
      actions: ['push', 'merge_request'],
    },
  ],
};

const project: ProjectSnapshot = {
  schemaVersion: 1,
  projectId: 'workspace',
  root: workspace,
  capturedAt: '2026-10-25T00:00:00.000Z',
  repositories: [
    {
      id: 'workspace',
      name: 'workspace',
      path: workspace,
      remoteIdentity: 'github.com/team/workspace',
      branch: 'spec/archive-cleanliness',
      head,
      worktree: { dirty: false, digest: 'sha256:clean', staged: 0, unstaged: 0, untracked: 0 },
    },
  ],
  diagnostics: [],
  digest: 'sha256:project',
};

describe('Delivery v3 Archive publication', () => {
  it('scopes Business cleanliness to the exact Specification Closure receipt', async () => {
    const inspect = vi.fn<DeliveryGitPort['inspect']>((repository, delivery, _policy, options) =>
      Promise.resolve({
        repositoryId: repository.id,
        repositoryName: repository.name,
        remoteIdentity: repository.remoteIdentity,
        sourceBranch: delivery.sourceBranch,
        targetBranch: delivery.targetBranch,
        head,
        tree: 'c'.repeat(40),
        remoteSourceOid: head,
        remoteTargetOid: target,
        clean: options?.allowedDirtyPaths === closurePaths,
      }),
    );
    const git: DeliveryGitPort = {
      checkpoint: () => Promise.reject(new Error('not used')),
      inspect,
      push: () => Promise.resolve(head),
    };
    const store: DeliveryV3StorePort = {
      load: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      commit: () => Promise.resolve(),
    };
    const mergeRequest = {
      provider: 'github',
      repositoryId: 'workspace',
      number: 42,
      url: 'https://github.com/team/workspace/pull/42',
    };
    const mergeRequests: MergeRequestPort = {
      capability: () => Promise.reject(new Error('not used')),
      find: () => Promise.resolve(null),
      findAll: () => Promise.resolve([]),
      create: () => Promise.resolve(mergeRequest),
      update: () => Promise.reject(new Error('not used')),
      status: () =>
        Promise.resolve({
          ...mergeRequest,
          state: 'open',
          sourceBranch: 'spec/archive-cleanliness',
          targetBranch: 'main',
          headCommit: head,
          ci: 'pending',
          review: 'pending',
          conversationsResolved: null,
          mergeCommit: null,
          mergedAt: null,
        }),
    };
    const evidence: DeliveryEvidencePort = {
      assertSatisfied: vi.fn(() => Promise.resolve()),
    };
    const service = new DeliveryServiceV3(
      store,
      git,
      mergeRequests,
      evidence,
      TEST_COMPOSITION_DIGEST,
    );

    await expect(
      service.publishArchive({
        project,
        intent,
        policy,
        reportContents: 'verified',
        evidenceBundleIds: ['bundle'],
        allowedDirtyPathsByDeliveryId: { primary: closurePaths },
      }),
    ).resolves.toMatchObject({
      receipts: [
        { deliveryId: 'primary', type: 'git.push', remoteOid: head },
        { deliveryId: 'primary', type: 'mr.create_or_update', mergeRequest: { number: 42 } },
      ],
    });
    expect(inspect).toHaveBeenCalledWith(
      project.repositories[0],
      expect.objectContaining({ sourceBranch: 'spec/archive-cleanliness' }),
      policy,
      { allowedDirtyPaths: closurePaths },
    );
  });

  it('rejects an Archive cleanliness scope that does not name a frozen delivery', async () => {
    const service = new DeliveryServiceV3(
      {
        load: () => Promise.resolve(null),
        list: () => Promise.resolve([]),
        commit: () => Promise.resolve(),
      },
      {
        checkpoint: () => Promise.reject(new Error('not used')),
        inspect: () => Promise.reject(new Error('must not inspect')),
        push: () => Promise.reject(new Error('must not push')),
      },
      {
        capability: () => Promise.reject(new Error('not used')),
        find: () => Promise.resolve(null),
        create: () => Promise.reject(new Error('must not create')),
        update: () => Promise.reject(new Error('not used')),
        status: () => Promise.reject(new Error('not used')),
      },
      { assertSatisfied: () => Promise.resolve() },
      TEST_COMPOSITION_DIGEST,
    );

    await expect(
      service.publishArchive({
        project,
        intent,
        policy,
        reportContents: 'verified',
        evidenceBundleIds: ['bundle'],
        allowedDirtyPathsByDeliveryId: { unknown: closurePaths },
      }),
    ).rejects.toThrow(/unknown delivery/i);
  });
});
