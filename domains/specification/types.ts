export const SPECIFICATION_API_VERSION = 'repoctopus.specification/v1alpha1' as const;

export interface SpecificationProviderIdentity {
  id: string;
  version: string;
  protocolVersion: typeof SPECIFICATION_API_VERSION;
}

export type SpecificationArtifactKind =
  | 'proposal'
  | 'design'
  | 'delta-specs'
  | 'tasks'
  | 'verification';

export interface SpecificationArtifact {
  id: string;
  kind: SpecificationArtifactKind;
  status: 'ready' | 'skipped' | 'missing';
  digest?: `sha256:${string}`;
}

export interface SpecificationChange {
  apiVersion: typeof SPECIFICATION_API_VERSION;
  kind: 'SpecificationChange';
  changeId: string;
  title: string;
  provider: SpecificationProviderIdentity;
  changeDigest: `sha256:${string}`;
  planningComplete: boolean;
  artifacts: SpecificationArtifact[];
  affectedCapabilities: string[];
  retiredCapabilities: string[];
}

export interface SpecificationTask {
  taskId: string;
  taskRevision: `sha256:${string}`;
  title: string;
  level: number;
  status: 'pending' | 'completed';
  completion: { source: 'imported-claim' } | { source: 'runtime-work'; workId: string } | null;
  blockedBy: string[];
  acceptanceCriteria: SpecificationAcceptanceCriterion[];
  requirementRefs: string[];
}

export interface SpecificationAcceptanceCriterion {
  acceptanceId: `acceptance-${string}`;
  taskId: string;
  taskRevision: `sha256:${string}`;
  text: string;
  requirementRefs: string[];
  source: string;
}

export interface SpecificationTaskSet {
  schemaVersion: 2;
  changeId: string;
  tasks: SpecificationTask[];
  digest: `sha256:${string}`;
}

export interface CompleteSpecificationTaskInput {
  changeId: string;
  taskId: string;
  taskRevision: `sha256:${string}`;
  workId?: string;
  signal?: AbortSignal;
}

export interface CompleteSpecificationTaskResult {
  schemaVersion: 1;
  changeId: string;
  taskId: string;
  taskRevision: `sha256:${string}`;
  updated: boolean;
  tasks: SpecificationTaskSet;
}

export interface SpecificationDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  artifactId?: string;
}

export interface SpecificationValidation {
  apiVersion: typeof SPECIFICATION_API_VERSION;
  kind: 'SpecificationValidation';
  changeId: string;
  provider: SpecificationProviderIdentity;
  strict: boolean;
  valid: boolean;
  validationDigest: `sha256:${string}`;
  diagnostics: SpecificationDiagnostic[];
}

export interface SpecificationArtifactInstructions {
  id: string;
  kind: Exclude<SpecificationArtifactKind, 'verification'>;
  instructionDigest: `sha256:${string}`;
  templateDigest: `sha256:${string}`;
}

export interface SpecificationArtifactContext extends SpecificationArtifactInstructions {
  instruction: string;
  template: string;
}

export interface SpecificationPlanningContext {
  schemaVersion: 1;
  schemaName: string;
  provider: SpecificationProviderIdentity;
  artifacts: SpecificationArtifactContext[];
  digest: `sha256:${string}`;
}

export type SpecificationPhaseOperation =
  | 'inspect-change'
  | 'write-planning-artifact'
  | 'validate-strict'
  | 'read-tasks'
  | 'complete-task-from-receipt'
  | 'prepare-closure'
  | 'close-change';

export interface SpecificationPhaseContext {
  schemaVersion: 1;
  phase: 'open' | 'design' | 'build' | 'verify' | 'archive';
  provider: SpecificationProviderIdentity;
  instruction: string;
  allowedOperations: readonly SpecificationPhaseOperation[];
  artifacts: readonly SpecificationArtifactContext[];
  digest: `sha256:${string}`;
}

export interface SpecificationSchemaInstructions {
  schemaVersion: 1;
  schemaName: string;
  provider: SpecificationProviderIdentity;
  artifacts: SpecificationArtifactInstructions[];
  digest: `sha256:${string}`;
}

export interface SpecificationMethodRule {
  id: string;
  statement: string;
  sources: readonly string[];
  sourceDigests: readonly `sha256:${string}`[];
  phases: readonly string[];
  artifactKinds: readonly Exclude<SpecificationArtifactKind, 'verification'>[];
  enforcement: 'context' | 'deterministic-validator' | 'review-rubric' | 'human-decision';
}

export interface SpecificationArtifactMethodGuidance {
  artifactId: string;
  artifactKind: Exclude<SpecificationArtifactKind, 'verification'>;
  rules: readonly SpecificationMethodRule[];
}

export interface SpecificationPlanningGuidance {
  schemaVersion: 1;
  kind: 'SpecificationPlanningGuidance';
  provider: SpecificationProviderIdentity;
  schemaName: string;
  schemaDigest: `sha256:${string}`;
  artifacts: readonly SpecificationArtifactMethodGuidance[];
  outputContract: {
    artifactKinds: readonly Exclude<SpecificationArtifactKind, 'verification'>[];
    allowAdditionalPlanningArtifacts: false;
    trackerPublish: false;
  };
  digest: `sha256:${string}`;
}

export interface SpecificationPlanningManifest {
  schemaVersion: 1;
  kind: 'SpecificationPlanningManifest';
  change: SpecificationChange;
  specificationRoot: PlanningSpecificationRoot;
  schema: SpecificationSchemaInstructions;
  semanticDigest: `sha256:${string}`;
}

export interface SpecificationUsageSnapshot {
  schemaVersion: 1;
  changeId: string;
  provider: SpecificationProviderIdentity;
  validationDigest: `sha256:${string}`;
  closurePlanDigest?: `sha256:${string}`;
}

export interface ChangeBranchReference {
  repositoryId: string;
  remoteIdentity: string;
  sourceBranch: string;
  targetBranch: string;
  remoteOid: string;
}

export interface PlanningArtifactSnapshot {
  id: string;
  kind: Exclude<SpecificationArtifactKind, 'verification'>;
  digest: `sha256:${string}`;
}

export interface PlanningSpecificationRoot {
  schemaVersion: 1;
  kind: 'SpecificationRoot';
  storeId: string;
  repositoryId: string;
}

export interface PlanningSnapshot {
  schemaVersion: 1;
  changeId: string;
  approvalPhase: 'open' | 'design';
  provider: SpecificationProviderIdentity;
  schema?: SpecificationSchemaInstructions;
  specificationRoot?: PlanningSpecificationRoot;
  changeDigest: `sha256:${string}`;
  validationDigest: `sha256:${string}`;
  artifacts: PlanningArtifactSnapshot[];
  affectedCapabilities: string[];
  changeBranch: ChangeBranchReference;
  publicationProvenanceDigest: `sha256:${string}`;
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  planningManifestDigest?: `sha256:${string}`;
  digest: `sha256:${string}`;
}

export type SpecificationApprovalDecision = 'approve' | 'revise' | 'reject';

export interface SpecificationApprovalProposal {
  schemaVersion: 1;
  kind: 'SpecificationApprovalProposal';
  changeId: string;
  approvalPhase: 'open' | 'design';
  specificationRoot: PlanningSpecificationRoot;
  provider: SpecificationProviderIdentity;
  schema: { name: string; digest: `sha256:${string}` };
  semanticDigest: `sha256:${string}`;
  affectedCapabilities: string[];
  targetBranch: string;
}

export interface SpecificationApprovalDecisionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  decisionType: 'specification-approval';
  requestId: string;
  changeId: string;
  approvalPhase: 'open' | 'design';
  snapshotDigest: `sha256:${string}`;
  proposal: SpecificationApprovalProposal;
  proposalHash: `sha256:${string}`;
  provider: SpecificationProviderIdentity;
  schema: SpecificationSchemaInstructions;
  artifacts: PlanningArtifactSnapshot[];
  affectedCapabilities: string[];
  changeBranch: ChangeBranchReference;
  options: SpecificationApprovalDecision[];
}

export interface SpecificationApprovalDecisionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionResponse';
  requestId: string;
  proposalHash: `sha256:${string}`;
  decision: SpecificationApprovalDecision;
  comment?: string;
}

export interface SpecificationApprovalActor {
  actorId: string;
  source: 'ide' | 'cli';
  authenticated: boolean;
}

export interface SpecificationApprovalRecord {
  schemaVersion: 1;
  requestId: string;
  changeId: string;
  approvalPhase: 'open' | 'design';
  snapshotDigest: `sha256:${string}`;
  proposalHash: `sha256:${string}`;
  approvalHash: `sha256:${string}` | null;
  decision: SpecificationApprovalDecision;
  actorId: string;
  source: SpecificationApprovalActor['source'];
  decidedAt: string;
  comment?: string;
}

export type SpecificationApprovalStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'changes_requested'
  | 'rejected';

export interface SpecificationApprovalState {
  schemaVersion: 1;
  changeId: string;
  approvalPhase: 'open' | 'design';
  stateVersion: number;
  status: SpecificationApprovalStatus;
  snapshot: PlanningSnapshot;
  decisionRequest: SpecificationApprovalDecisionRequest;
  decision: SpecificationApprovalRecord | null;
  updatedAt: string;
}

export interface SpecificationApprovalMigrationPlan {
  schemaVersion: 1;
  kind: 'SpecificationApprovalMigrationPlan';
  changeId: string;
  status: 'current' | 'migration_required';
  persistedSnapshotDigest: `sha256:${string}`;
  reason: string;
  requiredActions: readonly string[];
  externalSideEffects: readonly [];
  planDigest: `sha256:${string}`;
}

export interface SpecificationCompatibility {
  status: 'same' | 'drifted';
  reason: string;
}

export interface SpecificationClosurePlan {
  apiVersion: typeof SPECIFICATION_API_VERSION;
  kind: 'SpecificationClosurePlan';
  changeId: string;
  provider: SpecificationProviderIdentity;
  changeDigest: `sha256:${string}`;
  mergeFactsDigest: `sha256:${string}`;
  targetBaselineDigest: `sha256:${string}`;
  affectedCapabilities: string[];
  retiredCapabilities: string[];
  allowedPathPrefixes: string[];
  planDigest: `sha256:${string}`;
}

export interface SpecificationClosureResult {
  apiVersion: typeof SPECIFICATION_API_VERSION;
  kind: 'SpecificationClosureResult';
  changeId: string;
  provider: SpecificationProviderIdentity;
  planDigest: `sha256:${string}`;
  closureId: `sha256:${string}`;
  status: 'closed';
  archiveId: string;
  changedFiles: string[];
  candidate: {
    checkoutId: string;
    baseOid: string;
  };
}

export interface SpecificationFollowUpChangeInput {
  changeId: string;
  originalChangeId: string;
  publicationReceiptDigest: `sha256:${string}`;
  affectedMergeRequests: Array<{
    provider: string;
    repositoryId: string;
    number: number;
    url: string;
  }>;
  rationale: string;
  signal?: AbortSignal;
}

export interface SpecificationFollowUpChange {
  apiVersion: typeof SPECIFICATION_API_VERSION;
  kind: 'SpecificationFollowUpChange';
  changeId: string;
  originalChangeId: string;
  publicationReceiptDigest: `sha256:${string}`;
  status: 'opened';
  lifecycleEntry: 'open';
  proposalDigest: `sha256:${string}`;
}

export interface RequirementsAuthoritySource {
  sourceId: string;
  sourceType: 'specification' | 'design' | 'api-contract' | 'other';
  reference: string;
  summary: string;
}

export interface SpecificationConflict {
  apiVersion: typeof SPECIFICATION_API_VERSION;
  kind: 'SpecificationConflict';
  conflictId: string;
  changeId: string;
  summary: string;
  affectedStepIds: string[];
  sources: [
    RequirementsAuthoritySource,
    RequirementsAuthoritySource,
    ...RequirementsAuthoritySource[],
  ];
}

export interface SpecificationConflictDecisionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  decisionType: 'requirements-conflict';
  requestId: string;
  changeId: string;
  snapshotDigest: `sha256:${string}`;
  conflict: SpecificationConflict;
  pausedStepIds: string[];
  options: Array<{ id: string; label: string; sourceId: string; sourceRef: string }>;
}

export interface SpecificationConflictDecisionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionResponse';
  requestId: string;
  snapshotDigest: `sha256:${string}`;
  selectedOptionId: string;
  authorityUpdateDigest: `sha256:${string}`;
  comment?: string;
}

export interface SpecificationConflictResolution {
  conflictId: string;
  selectedSourceId: string;
  authorityUpdateDigest: `sha256:${string}`;
  resolvedAt: string;
}
