import { describe, expect, it } from 'vitest';

import {
  createPublicationReceipt,
  type PublicationReceiptItem,
} from '../domains/delivery/publication-receipt.js';

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const oid = (value: string) => value.repeat(40).slice(0, 40);

function item(role: 'business' | 'specification', publicationId: string): PublicationReceiptItem {
  return {
    publicationId,
    role,
    ...(role === 'business' ? { deliveryId: publicationId } : {}),
    repositoryId: role === 'business' ? 'app' : 'workspace',
    remoteIdentity: role === 'business' ? 'github.com/team/app' : 'github.com/team/specs',
    remote: 'origin',
    sourceBranch: `change/${publicationId}`,
    targetBranch: 'main',
    publishedOid: oid(role === 'business' ? 'a' : 'b'),
    mergeRequest: {
      provider: 'github',
      repositoryId: role === 'business' ? 'app' : 'workspace',
      number: role === 'business' ? 10 : 11,
      url: `https://github.com/team/repo/pull/${role === 'business' ? 10 : 11}`,
    },
    provenance: role === 'business' ? 'human-created' : 'runtime-created',
    verifiedAt: '2026-10-24T10:00:00.000Z',
  };
}

function receipt(items: PublicationReceiptItem[]) {
  return createPublicationReceipt({
    apiVersion: 'repoctopus.delivery/v1alpha1',
    kind: 'PublicationReceipt',
    schemaVersion: 2,
    changeId: 'archive-lite',
    runId: 'change-archive-lite-g2',
    deliverySnapshotDigest: hash('1'),
    verificationInputDigest: hash('2'),
    evidenceBundleIds: ['bundle-b', 'bundle-a', 'bundle-a'],
    specificationClosure: { closureId: hash('3'), planDigest: hash('4') },
    items,
  });
}

describe('PublicationReceipt', () => {
  it('is order independent and keeps same-repository deliveries distinct', () => {
    const primary = item('business', 'primary');
    const supplemental = { ...item('business', 'supplemental'), repositoryId: 'app' };
    const specification = item('specification', 'specification');
    const left = receipt([primary, supplemental, specification]);
    const right = receipt([specification, supplemental, primary]);
    expect(left.digest).toBe(right.digest);
    expect(left.items.map((entry) => entry.publicationId)).toEqual([
      'primary',
      'supplemental',
      'specification',
    ]);
    expect(left.evidenceBundleIds).toEqual(['bundle-a', 'bundle-b']);
  });

  it('rejects missing roles, invalid OIDs, and identity mismatches', () => {
    expect(() => receipt([item('business', 'primary')])).toThrow(/Business and Specification/u);
    expect(() => receipt([item('specification', 'specification')])).toThrow(
      /Business and Specification/u,
    );
    expect(() =>
      receipt([
        { ...item('business', 'primary'), publishedOid: 'not-an-oid' },
        item('specification', 'specification'),
      ]),
    ).toThrow(/OID/u);
    expect(() =>
      receipt([
        {
          ...item('business', 'primary'),
          mergeRequest: { ...item('business', 'primary').mergeRequest, repositoryId: 'other' },
        },
        item('specification', 'specification'),
      ]),
    ).toThrow(/merge request identity/u);
  });

  it('rejects unbounded or privacy-sensitive extension fields', () => {
    expect(() =>
      receipt([
        { ...item('business', 'primary'), body: 'full MR body' } as PublicationReceiptItem,
        item('specification', 'specification'),
      ]),
    ).toThrow(/unsupported fields: body/u);
    expect(() =>
      receipt([
        { ...item('business', 'primary'), remote: 'C:\\secrets\\token' },
        item('specification', 'specification'),
      ]),
    ).toThrow(/absolute path/u);
  });
});
