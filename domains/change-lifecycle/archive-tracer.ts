import {
  createDeliveryPublishWork,
  createSpecificationCloseWork,
  type ArchiveDeliveryInput,
} from './archive-input.js';
import { evolveChangeLifecycle, type ChangeLifecycleSnapshot } from './transition.js';
import type { ChangeLifecycleDefinition } from './transition.js';
import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
  type PublicationReceipt,
  type PublicationReceiptItem,
} from '../delivery/publication-receipt.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationClosureResult } from '../specification/types.js';

export interface ArchivePublicationBatch {
  deliverySnapshotDigest: `sha256:${string}`;
  items: Array<{
    item: PublicationReceiptItem;
    expectedPublishedOid: string;
  }>;
}

export interface ArchiveTracerPorts {
  closeSpecification(archive: ArchiveDeliveryInput): Promise<SpecificationClosureResult>;
  publishBusiness(archive: ArchiveDeliveryInput): Promise<ArchivePublicationBatch>;
  publishSpecification(
    archive: ArchiveDeliveryInput,
    closure: SpecificationClosureResult,
  ): Promise<{ item: PublicationReceiptItem; expectedPublishedOid: string }>;
}

export interface TraceArchiveInput {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  archive: ArchiveDeliveryInput;
  archiveSkill: SkillUsageSnapshot;
  prSkill: SkillUsageSnapshot;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
}

export interface TraceArchiveResult {
  closure: SpecificationClosureResult;
  receipt: PublicationReceipt;
  snapshot: ChangeLifecycleSnapshot;
}

function assertExactPublication(
  publication: { item: PublicationReceiptItem; expectedPublishedOid: string },
  role: PublicationReceiptItem['role'],
): void {
  if (
    publication.item.role !== role ||
    publication.item.publishedOid !== publication.expectedPublishedOid
  ) {
    throw new Error(`${role} publication did not verify the exact remote head OID`);
  }
}

/**
 * Runs the complete short-lived Archive pipeline. Ports own side effects; the
 * tracer owns their order, exact receipts, and the lifecycle terminal fact.
 */
export class ArchiveCompletionTracer {
  constructor(private readonly ports: ArchiveTracerPorts) {}

  async trace(input: TraceArchiveInput): Promise<TraceArchiveResult> {
    if (
      input.current.phase !== 'archive' ||
      input.current.status !== 'running' ||
      input.current.currentWork !== null ||
      input.current.verificationInput?.digest !== input.archive.verificationInputDigest
    ) {
      throw new Error('Archive tracer requires the accepted Verify input and an idle Archive');
    }
    const closeWork = createSpecificationCloseWork({
      definition: input.definition,
      checkEpoch: input.current.checkEpoch + 1,
      archive: input.archive,
      actionSkill: input.archiveSkill,
      workspaceRepositoryId: input.workspaceRepositoryId,
      repositoryIds: input.repositoryIds,
    });
    const preflight = evolveChangeLifecycle({
      definition: input.definition,
      current: input.current,
      observation: {
        kind: 'archive-preflight-ready',
        archiveInput: input.archive,
        work: closeWork,
      },
    });

    const closure = await this.ports.closeSpecification(input.archive);
    const resolvedPrSkill = input.prSkill;
    const publishWork = createDeliveryPublishWork({
      definition: input.definition,
      checkEpoch: preflight.snapshot.checkEpoch + 1,
      archive: input.archive,
      closure,
      actionSkill: resolvedPrSkill,
      workspaceRepositoryId: input.workspaceRepositoryId,
      repositoryIds: input.repositoryIds,
    });
    const closed = evolveChangeLifecycle({
      definition: input.definition,
      current: preflight.snapshot,
      observation: { kind: 'archive-specification-closed', closure, work: publishWork },
    });

    const business = await this.ports.publishBusiness(input.archive);
    if (business.items.length !== input.archive.businessDeliveries.length) {
      throw new Error('Business publication did not cover the frozen Delivery collection');
    }
    for (const delivery of input.archive.businessDeliveries) {
      const matches = business.items.filter(
        ({ item }) => item.role === 'business' && item.deliveryId === delivery.deliveryId,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Business publication identity is missing or ambiguous: ${delivery.deliveryId}`,
        );
      }
      const publication = matches[0]!;
      if (
        publication.item.repositoryId !== delivery.repositoryId ||
        publication.item.sourceBranch !== delivery.sourceBranch ||
        publication.item.targetBranch !== delivery.targetBranch
      ) {
        throw new Error(
          `Business publication drifted from the Delivery snapshot: ${delivery.deliveryId}`,
        );
      }
      assertExactPublication(publication, 'business');
    }
    const specification = await this.ports.publishSpecification(input.archive, closure);
    assertExactPublication(specification, 'specification');

    const receipt = createPublicationReceipt({
      apiVersion: PUBLICATION_RECEIPT_API_VERSION,
      kind: 'PublicationReceipt',
      schemaVersion: 2,
      changeId: input.current.identity.changeId,
      runId: input.current.identity.runId,
      deliverySnapshotDigest: business.deliverySnapshotDigest,
      verificationInputDigest: input.archive.verificationInputDigest,
      evidenceBundleIds: [input.archive.evidenceBundleId],
      specificationClosure: {
        closureId: closure.closureId,
        planDigest: closure.planDigest,
      },
      items: [...business.items.map(({ item }) => item), specification.item],
    });
    const completed = evolveChangeLifecycle({
      definition: input.definition,
      current: closed.snapshot,
      observation: { kind: 'archive-publication-receipt-accepted', receipt },
    });
    return { closure, receipt, snapshot: completed.snapshot };
  }
}
