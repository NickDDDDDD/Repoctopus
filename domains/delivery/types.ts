import type { ChangeBranchReference } from '../specification/types.js';

export type DeliveryStatus =
  | 'development'
  | 'verification_required'
  | 'awaiting_approval'
  | 'approved'
  | 'publishing'
  | 'partially_published'
  | 'in_review'
  | 'merged'
  | 'rejected'
  | 'repair_required';

export type PublicationActionType = 'git.push' | 'mr.create_or_update' | 'mr.refresh';

export interface QuickCheck {
  command: string;
  args: string[];
}

export interface DeliveryPolicy {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'DeliveryPolicy';
  checkpoint: {
    automatic: boolean;
    protectedBranches: string[];
    commitMessagePattern: string;
    quickChecks: Record<string, QuickCheck[]>;
  };
  publication: {
    remote: string;
    provider: 'github';
    githubApiBaseUrl: string;
    mrTitleTemplate: string;
    mrBodyTemplate: string;
  };
}

export interface DeliveryRepositoryIntent {
  repositoryId: string;
  sourceBranch: string;
  targetBranch: string;
  commitMessage: string;
  actions: Array<'push' | 'merge_request'>;
}

export interface DeliveryChangeMergeRequestIntent {
  repositoryId: string;
  remoteIdentity: string;
  sourceBranch: string;
  targetBranch: string;
  mergeRequest: MergeRequestIdentity;
}

export interface DeliveryIntent {
  schemaVersion: 2;
  changeId: string;
  changeMergeRequest: DeliveryChangeMergeRequestIntent;
  repositories: DeliveryRepositoryIntent[];
}

export interface DeliveryMergeRequestRecord {
  role: 'change' | 'business';
  repositoryId: string;
  remoteIdentity: string;
  sourceBranch: string;
  targetBranch: string;
  mergeRequest: MergeRequestIdentity | null;
}

export interface DeliveryMergeRequestSet {
  change: DeliveryMergeRequestRecord & {
    role: 'change';
    mergeRequest: MergeRequestIdentity;
  };
  business: DeliveryMergeRequestRecord[];
}

export interface MergeRequestReference {
  provider: string;
  remoteIdentity: string;
  number: number;
}

export interface DeliveryReconciliationCandidate {
  changeId: string;
  reference: MergeRequestReference;
}

export type DeliveryMergeRequestMatch =
  | { status: 'matched'; changeIds: [string]; diagnostic: null }
  | { status: 'not_found'; changeIds: []; diagnostic: 'delivery-event-no-match' }
  | {
      status: 'ambiguous';
      changeIds: string[];
      diagnostic: 'delivery-event-ambiguous-match';
    };

export interface DeliveryRepositoryFacts {
  repositoryId: string;
  repositoryName: string;
  remoteIdentity: string | null;
  sourceBranch: string;
  targetBranch: string;
  head: string;
  tree: string;
  remoteSourceOid: string | null;
  remoteTargetOid: string;
  clean: boolean;
}

export interface PublicationAction {
  actionId: string;
  type: PublicationActionType;
  repositoryId: string;
  sourceBranch: string;
  targetBranch: string;
  expectedHead: string;
  expectedRemoteSourceOid: string | null;
  expectedRemoteTargetOid: string;
}

export interface DeliverySnapshot {
  schemaVersion: 2;
  changeId: string;
  compositionDigest: string;
  digest: string;
  reportDigest: string;
  policyDigest: string;
  intentDigest: string;
  evidenceBundleIds: string[];
  repositories: DeliveryRepositoryFacts[];
  mergeRequests: DeliveryMergeRequestSet;
  plan: PublicationAction[];
  createdAt: string;
}

export type HumanDecision = 'approve' | 'request_changes' | 'reject';

export interface HumanDecisionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  requestId: string;
  decisionType: 'delivery-approval';
  changeId: string;
  snapshotDigest: string;
  reportDigest: string;
  evidenceBundleIds: string[];
  repositories: Array<{
    repositoryId: string;
    repositoryName: string;
    sourceBranch: string;
    targetBranch: string;
  }>;
  changeMergeRequest: DeliveryMergeRequestSet['change'];
  actions: Array<{ actionId: string; type: PublicationActionType; repositoryId: string }>;
  options: HumanDecision[];
}

export interface TrustedActor {
  subject: string;
  provider: string;
  sessionId: string;
}

export interface HumanDecisionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionResponse';
  requestId: string;
  snapshotDigest: string;
  decision: HumanDecision;
  comment?: string;
}

export interface ApprovalRecord {
  schemaVersion: 1;
  requestId: string;
  changeId: string;
  snapshotDigest: string;
  decision: HumanDecision;
  actor: TrustedActor;
  decidedAt: string;
  comment?: string;
}

export type PublicationActionStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface PublicationActionResult {
  actionId: string;
  status: PublicationActionStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  remoteOid?: string;
  mergeRequest?: MergeRequestIdentity;
  errorCode?: string;
}

export interface DeliveryState {
  schemaVersion: 2;
  changeId: string;
  stateVersion: number;
  status: DeliveryStatus;
  snapshot: DeliverySnapshot | null;
  decisionRequest: HumanDecisionRequest | null;
  approval: ApprovalRecord | null;
  actionResults: PublicationActionResult[];
  mergeEvidence: MergeEvidence[];
  mergeRequests: DeliveryMergeRequestSet | null;
  platformCapabilities: PlatformCapability[];
  updatedAt: string;
}

export interface MergeRequestIdentity {
  provider: string;
  repositoryId: string;
  number: number;
  url: string;
}

export interface MergeRequestStatus extends MergeRequestIdentity {
  state: 'open' | 'closed' | 'merged';
  sourceBranch?: string;
  targetBranch?: string;
  headCommit?: string;
  title?: string;
  body?: string;
  ci: 'pending' | 'passed' | 'failed' | 'unknown';
  review: 'pending' | 'approved' | 'changes_requested' | 'unknown';
  conversationsResolved: boolean | null;
  mergeCommit: string | null;
  mergedAt: string | null;
}

export interface DeliveryMergeRequestRefresh {
  match: DeliveryMergeRequestMatch;
  state: DeliveryState | null;
  mergeRequestStatuses: MergeRequestStatus[];
}

export interface MergeEvidence {
  repositoryId: string;
  mergeRequest: MergeRequestIdentity;
  mergeCommit: string;
  mergedAt: string;
  observedAt: string;
}

export interface PlatformCapability {
  name: 'branch-protection';
  status: 'available' | 'unavailable' | 'permission_denied' | 'misconfigured' | 'unknown';
  blocking: false;
  diagnosticCode: string;
}

export interface DeliveryDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  repositoryId?: string;
}

export interface CheckpointResult {
  repositoryId: string;
  created: boolean;
  head: string;
  checks: Array<{ command: string; passed: true }>;
  publication: {
    remote: string;
    branch: string;
    remoteOid: string;
    upstream: string;
  };
}

export type BusinessDeliveryAction = 'push' | 'merge_request';

export interface BusinessDeliveryIntentV3 {
  deliveryId: string;
  repositoryId: string;
  sourceBranch: string;
  targetBranch: string;
  commitMessage: string;
  actions: BusinessDeliveryAction[];
}

export interface BusinessSplitReasonV3 {
  kind: 'multi_repository' | 'ordered_delivery' | 'supplemental_fix';
  summary: string;
}

export type ChangeBranchReferenceV3 = ChangeBranchReference;

export interface DeliveryIntentV3 {
  schemaVersion: 3;
  changeId: string;
  changeBranch: ChangeBranchReferenceV3;
  businessDeliveries: BusinessDeliveryIntentV3[];
  businessSplitReason?: BusinessSplitReasonV3;
}

export interface BusinessDeliveryFactsV3 extends DeliveryRepositoryFacts {
  deliveryId: string;
}

export interface PublicationActionV3 extends PublicationAction {
  deliveryId: string;
}

export interface BusinessMergeRequestRecordV3 {
  deliveryId: string;
  repositoryId: string;
  remoteIdentity: string;
  sourceBranch: string;
  targetBranch: string;
  mergeRequest: MergeRequestIdentity | null;
}

export interface DeliverySnapshotV3 {
  schemaVersion: 3;
  changeId: string;
  compositionDigest: string;
  digest: string;
  reportDigest: string;
  policyDigest: string;
  intentDigest: string;
  evidenceBundleIds: string[];
  changeBranch: ChangeBranchReferenceV3;
  businessDeliveries: BusinessDeliveryFactsV3[];
  businessSplitReason: BusinessSplitReasonV3 | null;
  plan: PublicationActionV3[];
  createdAt: string;
}

export interface HumanDecisionRequestV3 {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  requestId: string;
  decisionType: 'delivery-approval';
  changeId: string;
  snapshotDigest: string;
  reportDigest: string;
  evidenceBundleIds: string[];
  changeBranch: ChangeBranchReferenceV3;
  businessDeliveries: Array<{
    deliveryId: string;
    repositoryId: string;
    repositoryName: string;
    sourceBranch: string;
    targetBranch: string;
  }>;
  businessSplitReason: BusinessSplitReasonV3 | null;
  actions: Array<{
    actionId: string;
    type: PublicationActionType;
    deliveryId: string;
    repositoryId: string;
  }>;
  options: HumanDecision[];
}

export interface BusinessMergeEvidenceV3 extends MergeEvidence {
  deliveryId: string;
}

export interface DeliveryClosureStateV3 {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  evidenceBundleId: string | null;
  specificationClosureId: string | null;
  publishedOid: string | null;
  errorCode: string | null;
}

export type FinalChangeMergeRequestStateV3 =
  | { status: 'creating'; mergeRequest: null; errorCode: null }
  | { status: 'open' | 'merged'; mergeRequest: MergeRequestIdentity; errorCode: null }
  | { status: 'failed'; mergeRequest: MergeRequestIdentity | null; errorCode: string };

export interface DeliveryStateV3 {
  schemaVersion: 3;
  changeId: string;
  stateVersion: number;
  status: DeliveryStatus;
  snapshot: DeliverySnapshotV3 | null;
  decisionRequest: HumanDecisionRequestV3 | null;
  approval: ApprovalRecord | null;
  actionResults: PublicationActionResult[];
  businessMergeRequests: BusinessMergeRequestRecordV3[];
  mergeEvidence: BusinessMergeEvidenceV3[];
  closure: DeliveryClosureStateV3 | null;
  finalChangeMergeRequest: FinalChangeMergeRequestStateV3 | null;
  platformCapabilities: PlatformCapability[];
  updatedAt: string;
}
