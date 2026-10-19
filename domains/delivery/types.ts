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

export interface DeliveryIntent {
  schemaVersion: 1;
  changeId: string;
  repositories: DeliveryRepositoryIntent[];
}

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
  schemaVersion: 1;
  changeId: string;
  compositionDigest: string;
  digest: string;
  reportDigest: string;
  policyDigest: string;
  intentDigest: string;
  evidenceBundleIds: string[];
  repositories: DeliveryRepositoryFacts[];
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
  schemaVersion: 1;
  changeId: string;
  stateVersion: number;
  status: DeliveryStatus;
  snapshot: DeliverySnapshot | null;
  decisionRequest: HumanDecisionRequest | null;
  approval: ApprovalRecord | null;
  actionResults: PublicationActionResult[];
  mergeEvidence: MergeEvidence[];
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
  ci: 'pending' | 'passed' | 'failed' | 'unknown';
  review: 'pending' | 'approved' | 'changes_requested' | 'unknown';
  conversationsResolved: boolean | null;
  mergeCommit: string | null;
  mergedAt: string | null;
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
}
