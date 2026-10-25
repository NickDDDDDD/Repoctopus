import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { MergeRequestIdentity } from './types.js';

export const PUBLICATION_RECEIPT_API_VERSION = 'repoctopus.delivery/v1alpha1' as const;

export type PublicationRole = 'business' | 'specification';
export type PublicationProvenance = 'runtime-created' | 'human-created' | 'recovered';

export interface PublicationReceiptItem {
  publicationId: string;
  role: PublicationRole;
  deliveryId?: string;
  repositoryId: string;
  remoteIdentity: string;
  remote: string;
  sourceBranch: string;
  targetBranch: string;
  publishedOid: string;
  mergeRequest: MergeRequestIdentity;
  provenance: PublicationProvenance;
  verifiedAt: string;
}

export interface PublicationReceipt {
  apiVersion: typeof PUBLICATION_RECEIPT_API_VERSION;
  kind: 'PublicationReceipt';
  schemaVersion: 2;
  changeId: string;
  runId: string;
  deliverySnapshotDigest: `sha256:${string}`;
  verificationInputDigest: `sha256:${string}`;
  evidenceBundleIds: string[];
  specificationClosure: {
    closureId: `sha256:${string}`;
    planDigest: `sha256:${string}`;
  };
  items: PublicationReceiptItem[];
  digest: `sha256:${string}`;
}

const OID = /^[a-f0-9]{40,64}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u;
const ITEM_KEYS = new Set([
  'publicationId',
  'role',
  'deliveryId',
  'repositoryId',
  'remoteIdentity',
  'remote',
  'sourceBranch',
  'targetBranch',
  'publishedOid',
  'mergeRequest',
  'provenance',
  'verifiedAt',
]);

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function text(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (/^[a-zA-Z]:[\\/]|^[/\\]{1,2}/u.test(value)) {
    throw new Error(`${label} must not contain an absolute path`);
  }
}

function normalizedItem(item: PublicationReceiptItem): PublicationReceiptItem {
  const unknown = Object.keys(item).filter((key) => !ITEM_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`Publication item contains unsupported fields: ${unknown.join(', ')}`);
  }
  if (!ID.test(item.publicationId)) throw new Error('Publication item id is invalid');
  if (item.role !== 'business' && item.role !== 'specification') {
    throw new Error('Publication item role is invalid');
  }
  if (item.role === 'business' && !item.deliveryId?.trim()) {
    throw new Error('Business publication item requires a delivery id');
  }
  if (item.role === 'specification' && item.deliveryId !== undefined) {
    throw new Error('Specification publication item must not declare a delivery id');
  }
  for (const [label, value] of [
    ['repository id', item.repositoryId],
    ['remote identity', item.remoteIdentity],
    ['remote', item.remote],
    ['source branch', item.sourceBranch],
    ['target branch', item.targetBranch],
  ] as const) {
    text(value, `Publication item ${label}`);
  }
  if (item.sourceBranch === item.targetBranch) {
    throw new Error('Publication item source and target branches must differ');
  }
  if (!OID.test(item.publishedOid)) throw new Error('Publication item OID is invalid');
  if (
    item.mergeRequest.repositoryId !== item.repositoryId ||
    !item.mergeRequest.provider.trim() ||
    !Number.isSafeInteger(item.mergeRequest.number) ||
    item.mergeRequest.number < 1 ||
    !/^https:\/\//u.test(item.mergeRequest.url)
  ) {
    throw new Error('Publication item merge request identity is invalid');
  }
  if (!['runtime-created', 'human-created', 'recovered'].includes(item.provenance)) {
    throw new Error('Publication item provenance is invalid');
  }
  if (Number.isNaN(Date.parse(item.verifiedAt))) {
    throw new Error('Publication item verification time is invalid');
  }
  return structuredClone(item);
}

function stable(input: Omit<PublicationReceipt, 'digest'>) {
  const items = input.items
    .map(normalizedItem)
    .sort((left, right) =>
      [left.role, left.repositoryId, left.deliveryId ?? '', left.publicationId]
        .join('\0')
        .localeCompare(
          [right.role, right.repositoryId, right.deliveryId ?? '', right.publicationId].join('\0'),
        ),
    );
  const evidenceBundleIds = [...new Set(input.evidenceBundleIds)].sort();
  return { ...structuredClone(input), evidenceBundleIds, items };
}

export function createPublicationReceipt(
  input: Omit<PublicationReceipt, 'digest'>,
): PublicationReceipt {
  if (
    input.apiVersion !== PUBLICATION_RECEIPT_API_VERSION ||
    input.kind !== 'PublicationReceipt' ||
    input.schemaVersion !== 2
  ) {
    throw new Error('Publication Receipt contract identity is invalid');
  }
  text(input.changeId, 'Publication Receipt change id');
  text(input.runId, 'Publication Receipt run id');
  if (!SHA256.test(input.deliverySnapshotDigest) || !SHA256.test(input.verificationInputDigest)) {
    throw new Error('Publication Receipt input digest is invalid');
  }
  if (
    !SHA256.test(input.specificationClosure.closureId) ||
    !SHA256.test(input.specificationClosure.planDigest)
  ) {
    throw new Error('Publication Receipt closure identity is invalid');
  }
  if (input.evidenceBundleIds.length === 0 || input.evidenceBundleIds.some((id) => !id.trim())) {
    throw new Error('Publication Receipt requires bounded Evidence Bundle identities');
  }
  const normalized = stable(input);
  if (normalized.items.length < 2) {
    throw new Error('Publication Receipt requires Business and Specification publications');
  }
  if (normalized.items.filter((item) => item.role === 'specification').length !== 1) {
    throw new Error('Publication Receipt requires exactly one Specification publication');
  }
  if (!normalized.items.some((item) => item.role === 'business')) {
    throw new Error('Publication Receipt requires at least one Business publication');
  }
  if (
    new Set(normalized.items.map((item) => item.publicationId)).size !== normalized.items.length
  ) {
    throw new Error('Publication Receipt item ids must be unique');
  }
  return { ...normalized, digest: sha256(normalized) };
}

export function assertPublicationReceipt(receipt: PublicationReceipt): void {
  const { digest, ...input } = receipt;
  if (!SHA256.test(digest) || createPublicationReceipt(input).digest !== digest) {
    throw new Error('Publication Receipt digest does not match its canonical contents');
  }
}
