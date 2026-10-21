import { describe, expect, it } from 'vitest';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

import { recordBusinessMergeRequest } from '../domains/delivery/merge-requests.js';
import { compareDeliverySnapshots, createDeliverySnapshot } from '../domains/delivery/snapshot.js';
import {
  initialDeliveryState,
  recordHumanDecision,
  requestDeliveryApproval,
} from '../domains/delivery/state.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
} from '../domains/delivery/types.js';
import { validateDeliveryIntent, validateDeliveryPolicy } from '../domains/delivery/validation.js';

const policy: DeliveryPolicy = {
  apiVersion: 'repoctopus/v1alpha1',
  kind: 'DeliveryPolicy',
  checkpoint: {
    automatic: true,
    protectedBranches: ['main'],
    commitMessagePattern: '^(feat|fix|docs|chore)(\\(.+\\))?: .+',
    quickChecks: {},
  },
  publication: {
    remote: 'origin',
    provider: 'github',
    githubApiBaseUrl: 'https://api.github.com',
    mrTitleTemplate: '{{changeId}}',
    mrBodyTemplate: '{{report}}',
  },
};

const intent: DeliveryIntent = {
  schemaVersion: 2,
  changeId: 'delivery-change',
  changeMergeRequest: {
    repositoryId: 'workspace-repository',
    remoteIdentity: 'example/workspace-repository',
    sourceBranch: 'feat/delivery-change',
    targetBranch: 'main',
    mergeRequest: {
      provider: 'github',
      repositoryId: 'workspace-repository',
      number: 10,
      url: 'https://example.test/workspace-repository/pull/10',
    },
  },
  repositories: [
    {
      repositoryId: 'repo-b',
      sourceBranch: 'feat/change',
      targetBranch: 'main',
      commitMessage: 'feat: change b',
      actions: ['push', 'merge_request'],
    },
    {
      repositoryId: 'repo-a',
      sourceBranch: 'feat/change',
      targetBranch: 'main',
      commitMessage: 'feat: change a',
      actions: ['push', 'merge_request'],
    },
  ],
};
const evidenceBundleIds = ['bundle-verified'];

function fact(repositoryId: string): DeliveryRepositoryFacts {
  return {
    repositoryId,
    repositoryName: repositoryId,
    remoteIdentity: `example/${repositoryId}`,
    sourceBranch: 'feat/change',
    targetBranch: 'main',
    head: `${repositoryId}-head`,
    tree: `${repositoryId}-tree`,
    remoteSourceOid: null,
    remoteTargetOid: 'main-head',
    clean: true,
  };
}

describe('delivery contract', () => {
  it('fails closed when policy or intent fields are missing', () => {
    expect(
      validateDeliveryPolicy({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'DeliveryPolicy',
        checkpoint: {},
        publication: {},
      }).map((item) => item.code),
    ).toEqual(
      expect.arrayContaining(['missing-automatic-mode', 'missing-commit-format', 'missing-remote']),
    );
    expect(
      validateDeliveryIntent({
        schemaVersion: 1,
        changeId: 'x',
        repositories: [],
      } as unknown as DeliveryIntent),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-intent-version' }),
        expect.objectContaining({ code: 'invalid-change-id' }),
        expect.objectContaining({ code: 'missing-change-merge-request' }),
        expect.objectContaining({ code: 'missing-repositories' }),
      ]),
    );
  });

  it('generates a stable snapshot independent of repository order', () => {
    const first = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const second = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent: { ...intent, repositories: [...intent.repositories].reverse() },
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
      repositories: [fact('repo-b'), fact('repo-a')],
      createdAt: '2027-01-01T00:00:00.000Z',
    });
    expect(first.digest).toBe(second.digest);
    expect(first.plan.map((action) => action.repositoryId)).toEqual([
      'repo-a',
      'repo-a',
      'repo-b',
      'repo-b',
    ]);
    expect(compareDeliverySnapshots(first, second)).toEqual([]);
  });

  it('allows the Change MR and a business MR to share one physical repository', () => {
    const sameRepositoryIntent: DeliveryIntent = {
      ...intent,
      changeMergeRequest: {
        ...intent.changeMergeRequest,
        repositoryId: 'repo-a',
        remoteIdentity: 'example/repo-a',
        mergeRequest: {
          ...intent.changeMergeRequest.mergeRequest,
          repositoryId: 'repo-a',
          number: 99,
        },
      },
    };
    expect(validateDeliveryIntent(sameRepositoryIntent)).toEqual([]);
    const snapshot = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent: sameRepositoryIntent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(snapshot.mergeRequests).toMatchObject({
      change: {
        role: 'change',
        repositoryId: 'repo-a',
        mergeRequest: { number: 99 },
      },
      business: [
        { role: 'business', repositoryId: 'repo-a', mergeRequest: null },
        { role: 'business', repositoryId: 'repo-b', mergeRequest: null },
      ],
    });
  });

  it('rejects a Change and business role that resolve to the same merge request', () => {
    const collidingBranches: DeliveryIntent = {
      ...intent,
      changeMergeRequest: {
        ...intent.changeMergeRequest,
        repositoryId: 'repo-a',
        remoteIdentity: 'example/repo-a',
        sourceBranch: 'feat/change',
        targetBranch: 'main',
        mergeRequest: {
          ...intent.changeMergeRequest.mergeRequest,
          repositoryId: 'repo-a',
          number: 99,
        },
      },
    };
    expect(validateDeliveryIntent(collidingBranches)).toContainEqual(
      expect.objectContaining({ code: 'change-business-branch-collision' }),
    );
    expect(() =>
      createDeliverySnapshot({
        compositionDigest: TEST_COMPOSITION_DIGEST,
        intent: collidingBranches,
        policy,
        reportContents: 'verified',
        evidenceBundleIds,
        repositories: [fact('repo-a'), fact('repo-b')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/same source and target branches/i);

    const validSnapshot = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent: {
        ...collidingBranches,
        changeMergeRequest: {
          ...collidingBranches.changeMergeRequest,
          sourceBranch: 'spec/coordinate-change',
        },
      },
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(() =>
      recordBusinessMergeRequest(validSnapshot.mergeRequests, 'repo-a', {
        provider: 'github',
        repositoryId: 'repo-a',
        number: 99,
        url: 'https://example.test/repo-a/pull/99',
      }),
    ).toThrow(/same merge request/i);
  });

  it('requires a clean snapshot and reports drift', () => {
    expect(() =>
      createDeliverySnapshot({
        compositionDigest: TEST_COMPOSITION_DIGEST,
        intent,
        policy,
        reportContents: 'verified',
        evidenceBundleIds,
        repositories: [{ ...fact('repo-a'), clean: false }, fact('repo-b')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow(/must be clean/i);
    const expected = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const current = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent,
      policy,
      reportContents: 'changed',
      evidenceBundleIds,
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(compareDeliverySnapshots(expected, current)).toContain('reportDigest');
    const changedEvidence = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds: ['bundle-new'],
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(compareDeliverySnapshots(expected, changedEvidence)).toContain('evidenceBundleIds');
  });

  it('records only a trusted decision for the pending snapshot', () => {
    const snapshot = createDeliverySnapshot({
      compositionDigest: TEST_COMPOSITION_DIGEST,
      intent,
      policy,
      reportContents: 'verified',
      evidenceBundleIds,
      repositories: [fact('repo-a'), fact('repo-b')],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const waiting = requestDeliveryApproval(
      initialDeliveryState(intent.changeId, '2026-01-01T00:00:00.000Z'),
      snapshot,
      '2026-01-01T00:00:01.000Z',
      'request-1',
    );
    expect(() =>
      recordHumanDecision(
        waiting,
        {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: 'wrong',
          snapshotDigest: snapshot.digest,
          decision: 'approve',
        },
        { subject: 'user', provider: 'cli', sessionId: 'session' },
        '2026-01-01T00:00:02.000Z',
      ),
    ).toThrow(/does not match/i);
    const approved = recordHumanDecision(
      waiting,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: 'request-1',
        snapshotDigest: snapshot.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'cli', sessionId: 'session' },
      '2026-01-01T00:00:02.000Z',
    );
    expect(approved).toMatchObject({
      status: 'approved',
      approval: { actor: { subject: 'user' }, snapshotDigest: snapshot.digest },
    });
  });
});
