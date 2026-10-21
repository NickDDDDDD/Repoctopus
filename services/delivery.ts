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
  ): Promise<DeliveryState>;
  abstract refreshForMergeRequest(
    reference: MergeRequestReference,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryMergeRequestRefresh | DeliveryMergeRequestRefreshV3>;
  reconciliationCandidates(signal?: AbortSignal): Promise<DeliveryReconciliationCandidate[]> {
    void signal;
    return Promise.resolve([]);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    delivery: Delivery;
  }
}
