import { Service, type Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../domains/project/types.js';
import type {
  PostMergePublicationReceipt,
  PostMergePublicationRequest,
} from '../domains/delivery/post-merge.js';
import type {
  DeliveryIntent,
  DeliveryIntentV3,
  DeliveryMergeRequestRefresh,
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
  abstract refresh(
    changeId: string,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryState>;
  abstract refreshForMergeRequest(
    reference: MergeRequestReference,
    policy: DeliveryPolicy,
    signal?: AbortSignal,
  ): Promise<DeliveryMergeRequestRefresh>;
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
