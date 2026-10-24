import { Service, type Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../domains/project/types.js';
import type {
  PostMergePublicationReceipt,
  PostMergePublicationReceiptV2,
  PostMergePublicationRequest,
  PostMergePublicationRequestV2,
} from '../domains/delivery/post-merge.js';
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
} from '../domains/delivery/types.js';
import type { DeliveryV2MigrationPlan } from '../domains/delivery/migration.js';
import type {
  ArchiveMergeRefreshResult,
  ArchivePublicationResult,
} from '../domains/delivery/service-v3.js';

export interface DeliveryPreparation {
  project: ProjectSnapshot;
  intent: DeliveryIntent | DeliveryIntentV3;
  policy: DeliveryPolicy;
  reportContents: string;
  evidenceBundleIds: string[];
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
    options: DeliveryPreparation & { intent: DeliveryIntentV3 },
    signal?: AbortSignal,
  ): Promise<ArchivePublicationResult> {
    void signal;
    return Promise.reject(
      new Error(`Delivery provider cannot publish lifecycle Archive for ${options.intent.changeId}`),
    );
  }
  refreshArchive(
    publication: ArchivePublicationResult,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<ArchiveMergeRefreshResult> {
    void policy;
    void signal;
    return Promise.reject(
      new Error(
        `Delivery provider cannot refresh lifecycle Archive for ${publication.snapshot.changeId}`,
      ),
    );
  }
  publishPostMerge(
    request: PostMergePublicationRequest,
    signal?: AbortSignal,
  ): Promise<PostMergePublicationReceipt> {
    void signal;
    return Promise.reject(
      new Error(`Delivery provider cannot publish post-merge closure for ${request.changeId}`),
    );
  }
  publishFinalChange(
    request: PostMergePublicationRequestV2,
    signal?: AbortSignal,
  ): Promise<PostMergePublicationReceiptV2> {
    void signal;
    return Promise.reject(
      new Error(`Delivery provider cannot publish final Change for ${request.changeId}`),
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
