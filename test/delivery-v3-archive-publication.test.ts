import { describe, expect, it, vi } from 'vitest';

import type {
  DeliveryEvidencePort,
  DeliveryGitPort,
  DeliveryV3StorePort,
  MergeRequestPort,
} from '../domains/delivery/ports.js';
import { DeliveryServiceV3 } from '../domains/delivery/service-v3.js';
import type {
  PublicationJournal,
  PublicationJournalStore,
} from '../domains/delivery/publication-journal.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

const head = 'a'.repeat(40);
const target = 'b'.repeat(40);
const workspace = 'C:/repoctopus-workspace';
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
  it.each([
    { observedHead: head, moveSource: false },
    { observedHead: 'd'.repeat(40), moveSource: false },
    { observedHead: head, moveSource: true },
  ])(
    'publishes only the frozen Business OID (checkout $observedHead, moved remote $moveSource)',
    async ({ observedHead, moveSource }) => {
      let observations = 0;
      let peerChangedSource = moveSource;
      const inspect = vi.fn<DeliveryGitPort['inspect']>((repository, delivery) =>
        Promise.resolve({
          repositoryId: repository.id,
          repositoryName: repository.name,
          remoteIdentity: repository.remoteIdentity,
          sourceBranch: delivery.sourceBranch,
          targetBranch: delivery.targetBranch,
          head: observedHead,
          tree: 'c'.repeat(40),
          remoteSourceOid: ++observations >= 3 && peerChangedSource ? 'e'.repeat(40) : head,
          remoteTargetOid: target,
          clean: true,
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
        create: vi.fn(() => Promise.resolve(mergeRequest)),
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
      let publicationJournal: PublicationJournal | null = null;
      const publicationJournalStore: PublicationJournalStore = {
        load: () => Promise.resolve(publicationJournal),
        create: (journal) => {
          publicationJournal = structuredClone(journal);
          return Promise.resolve();
        },
        compareAndSet: (journal, expectedDigest) => {
          if (publicationJournal?.digest !== expectedDigest) throw new Error('CAS conflict');
          publicationJournal = structuredClone(journal);
          return Promise.resolve();
        },
      };
      const service = new DeliveryServiceV3(
        store,
        git,
        mergeRequests,
        evidence,
        publicationJournalStore,
        TEST_COMPOSITION_DIGEST,
      );

      const publication = () =>
        service.publishArchive({
          runId: 'run-archive-cleanliness',
          project,
          intent,
          policy,
          reportContents: 'verified',
          evidenceBundleIds: ['bundle'],
          expectedRepositoryHeads: { workspace: head },
          authorizeBusinessEffect: vi.fn(() => Promise.resolve()),
        });
      if (observedHead !== head) {
        await expect(publication()).rejects.toThrow(/frozen/u);
        expect(publicationJournal).toBeNull();
        return;
      }
      if (moveSource) {
        await expect(publication()).rejects.toMatchObject({ code: 'publication-not-applied' });
        expect(mergeRequests.create).not.toHaveBeenCalled();
        peerChangedSource = false;
      }
      await expect(publication()).resolves.toMatchObject({
        receipts: [
          { deliveryId: 'primary', type: 'git.push', remoteOid: head },
          { deliveryId: 'primary', type: 'mr.create_or_update', mergeRequest: { number: 42 } },
        ],
      });
      expect(inspect).toHaveBeenCalledWith(
        project.repositories[0],
        expect.objectContaining({ sourceBranch: 'spec/archive-cleanliness' }),
        policy,
      );
    },
  );
});
