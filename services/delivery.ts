import { Service, type Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../domains/project/types.js';
import type {
  DeliveryIntent,
  DeliveryIntentV3,
  DeliveryMergeRequestRefresh,
  DeliveryMergeRequestRefreshV3,
  DeliveryPolicy,
  DeliveryReconciliationCandidate,
  DeliveryState,
  DeliveryStateV3,
  HumanDecisionResponse,
  MergeRequestReference,
  TrustedActor,
  MergeRequestStatus,
} from '../domains/delivery/types.js';
import type { PublicationReceiptItem } from '../domains/delivery/publication-receipt.js';
import type {
  SpecificationPublicationRequest,
  SpecificationPublicationResult,
} from '../domains/delivery/specification-publication.js';
import type { DeliveryV2MigrationPlan } from '../domains/delivery/migration.js';
import type { ArchivePublicationResult } from '../domains/delivery/service-v3.js';

export interface DeliveryPreparation {
  runId?: string;
  project: ProjectSnapshot;
  intent: DeliveryIntent | DeliveryIntentV3;
  policy: DeliveryPolicy;
  reportContents: string;
  evidenceBundleIds: string[];
  evidenceCompositionDigest?: `sha256:${string}`;
}

export interface ArchiveExecutionContext {
  readonly runId: string;
  readonly changeId: string;
  readonly compositionDigest: `sha256:${string}`;
}

export interface ArchiveDeliveryPreparation extends DeliveryPreparation {
  runId: string;
  intent: DeliveryIntentV3;
  execution: ArchiveExecutionContext;
  expectedRepositoryHeads: Readonly<Record<string, string>>;
}

export abstract class Delivery extends Service {
  constructor(context: Context) {
    super(context, 'delivery');
  }

  abstract checkpoint(
    project: ProjectSnapshot,
    intent: DeliveryIntent | DeliveryIntentV3,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<unknown>;
  abstract prepare(
    options: DeliveryPreparation,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3>;
  abstract status(changeId: string, signal?: AbortSignal): Promise<DeliveryState | DeliveryStateV3>;
  abstract decide(
    changeId: string,
    response: HumanDecisionResponse,
    actor: TrustedActor,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3>;
  abstract publish(
    options: DeliveryPreparation,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3>;
  publishArchive(
    options: ArchiveDeliveryPreparation,
    signal?: AbortSignal,
  ): Promise<ArchivePublicationResult> {
    void signal;
    return Promise.reject(
      new Error(
        `Delivery provider cannot publish lifecycle Archive for ${options.intent.changeId}`,
      ),
    );
  }
  validateArchiveIntent(
    intent: DeliveryIntentV3,
    policy: DeliveryPolicy,
    execution: ArchiveExecutionContext,
    signal?: AbortSignal,
  ): Promise<void> {
    void intent;
    void policy;
    void execution;
    void signal;
    return Promise.reject(new Error('Delivery provider cannot validate lifecycle Archive intent'));
  }
  publishSpecification(
    request: SpecificationPublicationRequest,
    signal?: AbortSignal,
  ): Promise<SpecificationPublicationResult> {
    void signal;
    return Promise.reject(
      new Error(`Delivery provider cannot publish specification closure for ${request.changeId}`),
    );
  }
  abstract refresh(
    changeId: string,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryState | DeliveryStateV3>;
  abstract refreshForMergeRequest(
    reference: MergeRequestReference,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryMergeRequestRefresh | DeliveryMergeRequestRefreshV3>;
  reconciliationCandidates(signal?: AbortSignal): Promise<DeliveryReconciliationCandidate[]> {
    void signal;
    return Promise.resolve([]);
  }
  observePublication(
    item: PublicationReceiptItem,
    signal?: AbortSignal,
  ): Promise<MergeRequestStatus> {
    void signal;
    return Promise.reject(
      new Error(`Delivery provider cannot observe publication: ${item.publicationId}`),
    );
  }
  migrationPlan(
    changeId: string,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryV2MigrationPlan> {
    void policy;
    void signal;
    return Promise.reject(new Error(`Delivery provider cannot plan v2 migration for ${changeId}`));
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    delivery: Delivery;
  }
}
