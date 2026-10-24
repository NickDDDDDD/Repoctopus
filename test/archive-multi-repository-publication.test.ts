import { describe, expect, it } from 'vitest';

import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
  type PublicationReceiptItem,
} from '../domains/delivery/publication-receipt.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
function item(input: {
  id: string;
  deliveryId?: string;
  repositoryId: string;
  source: string;
  oid: string;
  number: number;
}): PublicationReceiptItem {
  return {
    publicationId: input.id,
    role: input.deliveryId ? 'business' : 'specification',
    ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    repositoryId: input.repositoryId,
    remoteIdentity: `team/${input.repositoryId}`,
    remote: 'origin',
    sourceBranch: input.source,
    targetBranch: 'main',
    publishedOid: input.oid.repeat(40),
    mergeRequest: {
      provider: 'github',
      repositoryId: input.repositoryId,
      number: input.number,
      url: `https://github.com/team/${input.repositoryId}/pull/${input.number}`,
    },
    provenance: 'runtime-created',
    verifiedAt: '2026-10-24T00:00:00.000Z',
  };
}

function receipt(items: PublicationReceiptItem[]) {
  return createPublicationReceipt({
    apiVersion: PUBLICATION_RECEIPT_API_VERSION,
    kind: 'PublicationReceipt',
    schemaVersion: 1,
    changeId: 'multi-repo',
    generation: 1,
    runId: 'run-multi-repo',
    deliverySnapshotDigest: digest('1'),
    verificationInputDigest: digest('2'),
    evidenceBundleIds: ['bundle'],
    specificationClosure: { closureId: digest('3'), planDigest: digest('4') },
    items,
  });
}

describe('multi-repository Publication Receipt', () => {
  it('covers the default Business MR and an explicit multi-MR split without merge facts', () => {
    const specification = item({
      id: 'specification',
      repositoryId: 'workspace',
      source: 'spec/multi',
      oid: 'a',
      number: 1,
    });
    const primary = item({
      id: 'primary',
      deliveryId: 'primary',
      repositoryId: 'app',
      source: 'feature/primary',
      oid: 'b',
      number: 2,
    });
    expect(receipt([primary, specification]).items).toHaveLength(2);

    const supplemental = item({
      id: 'supplemental',
      deliveryId: 'supplemental',
      repositoryId: 'app',
      source: 'feature/supplemental',
      oid: 'c',
      number: 3,
    });
    const api = item({
      id: 'api',
      deliveryId: 'api',
      repositoryId: 'api',
      source: 'feature/api',
      oid: 'd',
      number: 4,
    });
    const forward = receipt([api, supplemental, specification, primary]);
    const reverse = receipt([primary, specification, supplemental, api]);
    expect(forward.digest).toBe(reverse.digest);
    expect(forward.items.filter((entry) => entry.repositoryId === 'app')).toMatchObject([
      { publicationId: 'primary', deliveryId: 'primary' },
      { publicationId: 'supplemental', deliveryId: 'supplemental' },
    ]);
    expect(JSON.stringify(forward)).not.toMatch(/mergeCommit|mergedAt|allMerged/u);
  });
});
