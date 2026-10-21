import { describe, expect, it } from 'vitest';

import {
  compareDeliverySnapshotsV3,
  createDefaultDeliveryIntentV3,
  createDeliverySnapshotV3,
  deliveryIntentDigestV3,
  initialDeliveryStateV3,
  normalizeDeliveryIntentV3,
  recordHumanDecisionV3,
  requestDeliveryApprovalV3,
} from '../domains/delivery/v3.js';
import type {
  BusinessDeliveryFactsV3,
  DeliveryIntentV3,
  DeliveryPolicy,
} from '../domains/delivery/types.js';
import { TEST_COMPOSITION_DIGEST } from './helpers/fixtures.js';

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
    mrBodyTemplate: '{{report}}',
  },
};

const changeBranch = {
  repositoryId: 'workspace',
  remoteIdentity: 'github.com/team/workspace',
  sourceBranch: 'spec/delivery-v3',
  targetBranch: 'main',
  remoteOid: '1'.repeat(40),
};

const intent = createDefaultDeliveryIntentV3({
  changeId: 'delivery-v3',
  changeBranch,
  businessDelivery: {
    repositoryId: 'app',
    sourceBranch: 'feat/delivery-v3',
    targetBranch: 'main',
    commitMessage: 'feat: implement delivery v3',
    actions: ['merge_request', 'push'],
  },
});

function facts(overrides: Partial<BusinessDeliveryFactsV3> = {}): BusinessDeliveryFactsV3 {
  return {
    deliveryId: 'primary',
    repositoryId: 'app',
    repositoryName: 'app',
    remoteIdentity: 'github.com/team/app',
    sourceBranch: 'feat/delivery-v3',
    targetBranch: 'main',
    head: '2'.repeat(40),
    tree: '3'.repeat(40),
    remoteSourceOid: '2'.repeat(40),
    remoteTargetOid: '4'.repeat(40),
    clean: true,
    ...overrides,
  };
}

function snapshot(
  options: {
    intent?: DeliveryIntentV3;
    facts?: BusinessDeliveryFactsV3[];
    report?: string;
  } = {},
) {
  return createDeliverySnapshotV3({
    compositionDigest: TEST_COMPOSITION_DIGEST,
    intent: options.intent ?? intent,
    policy,
    reportContents: options.report ?? 'verified',
    evidenceBundleIds: ['bundle-verified'],
    businessDeliveries: options.facts ?? [facts()],
    createdAt: '2026-10-22T00:00:00.000Z',
  });
}

describe('Delivery v3 domain', () => {
  it('creates one stable Business delivery by default without a Change MR', () => {
    expect(intent).toMatchObject({
      schemaVersion: 3,
      changeBranch: { sourceBranch: 'spec/delivery-v3', remoteOid: '1'.repeat(40) },
      businessDeliveries: [
        {
          deliveryId: 'primary',
          repositoryId: 'app',
          actions: ['push', 'merge_request'],
        },
      ],
    });
    expect(intent).not.toHaveProperty('changeMergeRequest');
    expect(intent).not.toHaveProperty('repositories');
  });

  it('normalizes collection order and binds stable delivery IDs into the digest', () => {
    const multiple: DeliveryIntentV3 = {
      ...intent,
      businessDeliveries: [
        {
          ...intent.businessDeliveries[0]!,
          deliveryId: 'secondary',
          repositoryId: 'api',
          sourceBranch: 'feat/delivery-v3-api',
        },
        intent.businessDeliveries[0]!,
      ],
      businessSplitReason: {
        kind: 'multi_repository',
        summary: 'The workspace and API require independent review ownership.',
      },
    };
    const reversed: DeliveryIntentV3 = {
      ...multiple,
      businessDeliveries: [...multiple.businessDeliveries].reverse(),
    };
    expect(normalizeDeliveryIntentV3(multiple)).toEqual(normalizeDeliveryIntentV3(reversed));
    expect(deliveryIntentDigestV3(multiple)).toBe(deliveryIntentDigestV3(reversed));
    expect(
      deliveryIntentDigestV3({
        ...multiple,
        businessDeliveries: multiple.businessDeliveries.map((delivery) =>
          delivery.deliveryId === 'secondary'
            ? { ...delivery, deliveryId: 'replacement' }
            : delivery,
        ),
      }),
    ).not.toBe(deliveryIntentDigestV3(multiple));
  });

  it('models independent source branches in one repository as separate deliveries', () => {
    const sameRepository: DeliveryIntentV3 = {
      ...intent,
      businessDeliveries: [
        intent.businessDeliveries[0]!,
        {
          ...intent.businessDeliveries[0]!,
          deliveryId: 'supplemental',
          sourceBranch: 'fix/delivery-v3-follow-up',
          commitMessage: 'feat: add the approved supplemental fix',
        },
      ],
      businessSplitReason: {
        kind: 'supplemental_fix',
        summary: 'The approved follow-up must retain independent review and merge evidence.',
      },
    };

    expect(normalizeDeliveryIntentV3(sameRepository).businessDeliveries).toHaveLength(2);
    expect(() => deliveryIntentDigestV3(sameRepository)).not.toThrow();
    expect(() =>
      deliveryIntentDigestV3({
        ...sameRepository,
        businessDeliveries: sameRepository.businessDeliveries.map((delivery) =>
          delivery.deliveryId === 'supplemental'
            ? { ...delivery, sourceBranch: 'feat/delivery-v3' }
            : delivery,
        ),
      }),
    ).toThrow(/duplicates another merge request mapping/i);
  });

  it('rejects implicit multi-MR plans and mismatched or dirty facts', () => {
    expect(() =>
      deliveryIntentDigestV3({
        ...intent,
        businessDeliveries: [
          intent.businessDeliveries[0]!,
          {
            ...intent.businessDeliveries[0]!,
            deliveryId: 'secondary',
            sourceBranch: 'feat/delivery-v3-secondary',
          },
        ],
      }),
    ).toThrow(/split reason/i);
    expect(() => snapshot({ facts: [facts({ sourceBranch: 'feat/other' })] })).toThrow(
      /do not match intent/i,
    );
    expect(() => snapshot({ facts: [facts({ clean: false })] })).toThrow(/must be clean/i);
  });

  it('reports Change branch, Business collection, and report drift independently', () => {
    const expected = snapshot();
    const branchDrift = snapshot({
      intent: {
        ...intent,
        changeBranch: { ...intent.changeBranch, remoteOid: '5'.repeat(40) },
      },
    });
    expect(compareDeliverySnapshotsV3(expected, branchDrift)).toEqual(
      expect.arrayContaining(['intentDigest', 'changeBranch']),
    );
    const businessDrift = snapshot({ facts: [facts({ head: '6'.repeat(40) })] });
    expect(compareDeliverySnapshotsV3(expected, businessDrift)).toEqual(
      expect.arrayContaining(['businessDeliveries', 'plan']),
    );
    expect(compareDeliverySnapshotsV3(expected, snapshot({ report: 'changed' }))).toContain(
      'reportDigest',
    );
  });

  it('transitions approval without inventing an implementation-time Change MR', () => {
    const captured = snapshot();
    const waiting = requestDeliveryApprovalV3(
      initialDeliveryStateV3(intent.changeId, '2026-10-22T00:00:00.000Z'),
      captured,
      '2026-10-22T00:00:01.000Z',
      'delivery-request-1',
    );
    expect(waiting).toMatchObject({
      schemaVersion: 3,
      status: 'awaiting_approval',
      decisionRequest: {
        changeBranch: { sourceBranch: 'spec/delivery-v3' },
        businessDeliveries: [{ deliveryId: 'primary', repositoryId: 'app' }],
      },
      businessMergeRequests: [{ deliveryId: 'primary', repositoryId: 'app', mergeRequest: null }],
      closure: null,
      finalChangeMergeRequest: null,
    });
    expect(waiting.decisionRequest).not.toHaveProperty('changeMergeRequest');

    const approved = recordHumanDecisionV3(
      waiting,
      {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: 'delivery-request-1',
        snapshotDigest: captured.digest,
        decision: 'approve',
      },
      { subject: 'user', provider: 'cli', sessionId: 'session' },
      '2026-10-22T00:00:02.000Z',
    );
    expect(approved).toMatchObject({
      status: 'approved',
      approval: { snapshotDigest: captured.digest },
      finalChangeMergeRequest: null,
    });
  });
});
