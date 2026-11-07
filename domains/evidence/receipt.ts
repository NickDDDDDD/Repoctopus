import { createHash } from 'node:crypto';
import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  assertEvidenceDependencyRecord,
  createEvidenceDependencyRecord,
  evidenceDependencySetDigest,
  type EvidenceDependency,
} from './dependencies.js';
import { evidenceInputDigest, type EvidenceNodeInputSnapshot } from './input-snapshot.js';
import type { EvidenceReceipt } from './types.js';

export type EvidenceReceiptFacts = Omit<
  EvidenceReceipt,
  | 'schemaVersion'
  | 'apiVersion'
  | 'kind'
  | 'receiptId'
  | 'dependencies'
  | 'sourceFingerprint'
  | 'derivedInputs'
  | 'outputManifest'
> &
  Partial<Pick<EvidenceReceipt, 'sourceFingerprint' | 'derivedInputs' | 'outputManifest'>>;

export function createEvidenceReceipt(
  facts: EvidenceReceiptFacts,
  dependencies: readonly EvidenceDependency[] = [
    { partition: 'implementation-content', identity: evidenceInputDigest(facts.inputFingerprint) },
  ],
  dependsOnEvidenceIds: readonly string[] = [],
): EvidenceReceipt {
  const body = Object.fromEntries(
    Object.entries(facts).filter(
      ([key]) =>
        !['schemaVersion', 'apiVersion', 'kind', 'receiptId', 'dependencies'].includes(key),
    ),
  ) as EvidenceReceiptFacts;
  const stable = {
    schemaVersion: 1 as const,
    apiVersion: 'repoctopus/v1alpha1' as const,
    kind: 'EvidenceReceipt' as const,
    ...body,
    sourceFingerprint: facts.sourceFingerprint ?? facts.inputFingerprint,
    derivedInputs: facts.derivedInputs ?? [],
    outputManifest: facts.outputManifest ?? null,
  };
  const receiptId = createHash('sha256')
    .update(
      canonicalJson({
        ...stable,
        dependencySetDigest: evidenceDependencySetDigest(dependencies, dependsOnEvidenceIds),
      }),
    )
    .digest('hex');
  return {
    ...stable,
    receiptId,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'receipt',
      subjectId: receiptId,
      dependencies,
      dependsOnEvidenceIds,
    }),
  };
}

export function validateEvidenceReceiptIdentity(receipt: EvidenceReceipt): boolean {
  const { receiptId, dependencies, ...facts } = receipt;
  return (
    createEvidenceReceipt(facts, dependencies.dependencies, dependencies.dependsOnEvidenceIds)
      .receiptId === receiptId
  );
}

export function evidenceReceiptInputCurrent(
  receipt: EvidenceReceipt,
  snapshot: EvidenceNodeInputSnapshot,
  receipts: readonly EvidenceReceipt[],
): boolean {
  if (receipt.nodeId !== snapshot.nodeId || receipt.sourceFingerprint !== snapshot.fingerprint)
    return false;
  const producerIds = [...new Set(snapshot.derivedFrom.map((claim) => claim.producerId))].sort();
  if (
    canonicalJson(receipt.derivedInputs.map((entry) => entry.producerId).sort()) !==
    canonicalJson(producerIds)
  )
    return false;
  for (const derived of receipt.derivedInputs) {
    const producer = receipts.find((entry) => entry.nodeId === derived.producerId);
    if (
      !producer ||
      producer.attemptId !== receipt.attemptId ||
      producer.receiptId !== derived.producerReceiptId ||
      !producer.outputManifest ||
      canonicalJson(producer.outputManifest) !== canonicalJson(derived.manifest)
    )
      return false;
  }
  const fingerprint = receipt.derivedInputs.length
    ? evidenceInputDigest({
        source: snapshot.fingerprint,
        derived: receipt.derivedInputs.map(({ producerId, contentDigest }) => ({
          producerId,
          contentDigest,
        })),
      }).slice(7)
    : snapshot.fingerprint;
  if (receipt.inputFingerprint !== fingerprint || !validateEvidenceReceiptIdentity(receipt))
    return false;
  try {
    assertEvidenceDependencyRecord(receipt.dependencies, 'receipt', receipt.receiptId);
  } catch {
    return false;
  }
  const expected = createEvidenceDependencyRecord({
    subjectKind: 'receipt',
    subjectId: receipt.receiptId,
    dependencies: [
      ...snapshot.dependencies,
      ...receipt.derivedInputs.map((entry) => ({
        partition: 'implementation-content' as const,
        identity: entry.contentDigest,
      })),
    ],
    dependsOnEvidenceIds: [...new Set([...snapshot.predecessorNodeIds, ...producerIds])].map(
      (id) => receipts.find((entry) => entry.nodeId === id)?.receiptId ?? 'missing',
    ),
  });
  return (
    canonicalJson(expected) === canonicalJson(receipt.dependencies) &&
    (snapshot.outputs.length === 0 ? receipt.outputManifest === null : !!receipt.outputManifest)
  );
}
