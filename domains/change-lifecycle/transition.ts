import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationArtifactKind } from '../specification/types.js';
import type { SpecificationTask } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { VerificationInput } from './verification-input.js';
import type { ArchiveDeliveryInput } from './archive-input.js';
import type { PublicationReceipt } from '../delivery/publication-receipt.js';
import { assertPublicationReceipt } from '../delivery/publication-receipt.js';
import type { SpecificationClosureResult } from '../specification/types.js';
import type {
  BuildActionKind,
  BuildConfiguration,
  BuildConfigurationProposal,
  BuildInvalidation,
  BuildCheckEvidence,
  BuildExecutionMode,
  BuildPlan,
  BuildProtocolState,
  BuildReviewMode,
  BuildTddMode,
  ExecutionIsolation,
  ExecutionWorkspaceIntent,
  PlanEvidence,
  PackageCompletionEvidence,
} from './build-protocol.js';
import { advanceBuildProtocol } from './build-protocol.js';

export const CHANGE_PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
export type ChangePhase = (typeof CHANGE_PHASES)[number];

export const CHANGE_RUN_STATUSES = [
  'running',
  'waiting',
  'blocked',
  'completed',
  'failed',
  'migration_required',
] as const;
export type RunStatus = (typeof CHANGE_RUN_STATUSES)[number];

export interface ChangeLifecyclePhaseDefinition {
  phase: ChangePhase;
  workKinds: readonly string[];
  requiredValidatorProfiles: readonly string[];
  extensionCheckpoints: readonly string[];
}

export type ChangeLifecycleTransitionKind = 'advance' | 'self' | 'fallback' | 'halt' | 'complete';

export interface ChangeLifecycleTransitionDefinition {
  id: string;
  kind: ChangeLifecycleTransitionKind;
  from: {
    phase: ChangePhase;
    statuses: readonly RunStatus[];
  };
  to: {
    phase: ChangePhase;
    status: RunStatus;
  };
  trigger: string;
  requiredValidatorProfile?: string;
}

export interface ChangeLifecycleDefinition {
  schemaVersion: 3;
  id: string;
  version: string;
  compatibleDigests?: readonly `sha256:${string}`[];
  phases: readonly ChangeLifecyclePhaseDefinition[];
  works: readonly ChangeLifecycleWorkDefinition[];
  transitions: readonly ChangeLifecycleTransitionDefinition[];
  buildProtocol: BuildProtocolDefinition;
}

export interface BuildProtocolActionDefinition {
  action: BuildActionKind;
  workKind: string | null;
  validatorProfile: string;
  next: BuildActionKind | 'verify';
  autoTransition: boolean;
}

export interface BuildProtocolDefinition {
  schemaVersion: 1;
  actions: readonly BuildProtocolActionDefinition[];
  policies: {
    executionModes: readonly BuildExecutionMode[];
    tddModes: readonly BuildTddMode[];
    reviewModes: readonly BuildReviewMode[];
    isolations: readonly ExecutionIsolation[];
    allowRuntimeModeSwitch: false;
  };
}

export interface LifecycleSkillReference {
  name: string;
}

export interface LifecycleWriteScopeDefinition {
  repositorySelector: 'workspace' | 'all-repositories';
  paths: readonly string[];
  operations: readonly ('create' | 'update' | 'delete')[];
}

export interface ChangeLifecycleWorkDefinition {
  kind: string;
  buildAction?: BuildActionKind;
  executionMode?: BuildExecutionMode;
  tddMode?: BuildTddMode;
  configurationId?: string;
  planId?: string;
  planRevision?: number;
  packageId?: string;
  phase: ChangePhase;
  actionSkill?: LifecycleSkillReference;
  augmentationSkills: readonly LifecycleSkillReference[];
  methodProfile: MethodProfileSnapshot;
  capabilities: readonly string[];
  sideEffectClass: WorkSideEffectClass;
  writeScopes: readonly LifecycleWriteScopeDefinition[];
  outputContract: WorkOutputContract;
  validatorProfile: ValidatorProfileSnapshot;
  checkpoint: string;
}

export interface ChangeRunIdentity {
  workspaceId: string;
  changeId: string;
  runId: string;
}

export interface ChangeLifecycleDefinitionSnapshot {
  id: string;
  version: string;
  digest: `sha256:${string}`;
}

export interface MethodProfileSnapshot {
  id: string;
  version: string;
  digest: `sha256:${string}`;
  sourceDigests: readonly `sha256:${string}`[];
  ruleIds: readonly string[];
}

export type WorkSideEffectClass =
  | 'none'
  | 'specification-write'
  | 'repository-write'
  | 'process'
  | 'git-publish'
  | 'platform-mutation';

export interface WorkWriteScope {
  repositoryId: string;
  paths: readonly string[];
  operations: readonly ('create' | 'update' | 'delete')[];
}

export interface WorkOutputContract {
  providerId?: string;
  artifactKinds: readonly SpecificationArtifactKind[];
  trackerPublish: boolean;
}

export interface ValidatorProfileSnapshot {
  id: string;
  version: string;
  digest: `sha256:${string}`;
}

export interface WorkDescriptor {
  schemaVersion: 2;
  workId: string;
  checkEpoch: number;
  phase: ChangePhase;
  kind: string;
  buildAction?: BuildActionKind;
  configurationId?: string;
  planId?: string;
  planRevision?: number;
  packageId?: string;
  taskId?: string;
  taskRevision?: `sha256:${string}`;
  actionSkill?: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  methodProfile: MethodProfileSnapshot;
  capabilities: readonly string[];
  sideEffectClass: WorkSideEffectClass;
  writeScopes: readonly WorkWriteScope[];
  inputDigest: `sha256:${string}`;
  outputContract: WorkOutputContract;
  validatorProfile: ValidatorProfileSnapshot;
  authorizationSource: {
    kind: 'lifecycle-definition';
    definitionId: string;
    definitionVersion: string;
  };
  checkpoint: string;
}

interface WaitConditionBase {
  schemaVersion: 1;
  waitId: string;
  reason: string;
  inputDigest: `sha256:${string}`;
}

export interface HumanDecisionWaitCondition extends WaitConditionBase {
  kind: 'human-decision';
  requestId: string;
  proposalDigest: `sha256:${string}`;
}

export interface RetryWaitCondition extends WaitConditionBase {
  kind: 'retry';
  notBefore: string;
  attempt: number;
}

export interface ExternalFactWaitCondition extends WaitConditionBase {
  kind: 'external-fact';
  providerId: string;
  factIdentityDigest: `sha256:${string}`;
}

export type WaitCondition =
  | HumanDecisionWaitCondition
  | RetryWaitCondition
  | ExternalFactWaitCondition;

export interface ChangeRunBlocker {
  code: string;
  message: string;
  evidenceIds: readonly string[];
  sinceRevision: number;
}

export interface ChangeLifecycleState {
  schemaVersion: 2;
  identity: ChangeRunIdentity;
  definition: ChangeLifecycleDefinitionSnapshot;
  revision: number;
  checkEpoch: number;
  phase: ChangePhase;
  currentWork: WorkDescriptor | null;
  waitCondition: WaitCondition | null;
  blocker: ChangeRunBlocker | null;
  tasks?: readonly SpecificationTask[];
  workspaceIntent?: ExecutionWorkspaceIntent;
  buildProtocol?: BuildProtocolState;
  openApprovalDigest?: `sha256:${string}`;
  planningDigest?: `sha256:${string}`;
  adoptedCompletionClaimDigest?: `sha256:${string}`;
  verificationInput?: VerificationInput;
  verificationInvalidation?: VerificationInvalidation;
  archiveDeliveryInput?: ArchiveDeliveryInput;
  specificationClosure?: SpecificationClosureResult;
  publicationReceipt?: PublicationReceipt;
}

export interface VerificationInvalidation {
  schemaVersion: 1;
  kind: 'evidence-gate-blocked' | 'implementation-drift';
  priorInputDigest: `sha256:${string}`;
  evidenceInputFingerprint: string;
  attemptId: string;
  bundleId: string | null;
  reason: string;
}

export interface ChangeLifecycleSnapshot extends ChangeLifecycleState {
  status: RunStatus;
}

export interface ChangeTaskProgress {
  total: number;
  completed: number;
  currentTaskId: string | null;
}

export interface ChangeEvidenceSummary {
  gateStatus: 'not-evaluated' | 'pending' | 'satisfied' | 'failed';
  acceptedBundleIds: readonly string[];
  latestAttemptId: string | null;
}

export interface ChangeNextAction {
  id: string;
  kind: 'work' | 'decision' | 'wait' | 'repair' | 'none';
  label: string;
}

export interface ChangeRunFreshness {
  stateVersion: number;
  trajectoryOffset: number;
  observedAt: string;
}

export interface ChangeRunProjection extends ChangeLifecycleSnapshot {
  taskProgress: ChangeTaskProgress;
  evidence: ChangeEvidenceSummary;
  build: ChangeBuildSummary | null;
  nextActions: readonly ChangeNextAction[];
  freshness: ChangeRunFreshness;
}

export interface ChangeBuildSummary {
  action: BuildActionKind | null;
  actionAttempt: number;
  configurationId: string | null;
  executionMode: BuildExecutionMode | null;
  tddMode: BuildTddMode | null;
  isolation: ExecutionIsolation;
  planId: string | null;
  planRevision: number | null;
  packageId: string | null;
  completedPackages: number;
  totalPackages: number;
  checkAccepted: boolean;
}

export interface ChangeLifecycleTransitionFact {
  schemaVersion: 2;
  transitionId: string;
  definition: ChangeLifecycleDefinitionSnapshot;
  revision: number;
  from: { phase: ChangePhase; status: RunStatus; checkEpoch: number };
  to: { phase: ChangePhase; status: RunStatus; checkEpoch: number };
  workId: string | null;
  waitId: string | null;
  work?: Pick<WorkDescriptor, 'workId' | 'kind' | 'taskId' | 'validatorProfile'> | null;
  wait?: Pick<WaitCondition, 'waitId' | 'kind'> | null;
  invalidation?: {
    kind: 'planning-semantic-drift';
    supersededPlanningDigest: `sha256:${string}`;
    observedPlanningDigest: `sha256:${string}`;
    supersededWorkId: string | null;
    supersededTaskRevisions: readonly `sha256:${string}`[];
    evidenceIds: readonly string[];
  };
}

export type ChangeLifecycleObservation =
  | {
      kind: 'open-work-ready';
      work: WorkDescriptor;
    }
  | {
      kind: 'open-gate';
      result: 'blocked' | 'waiting' | 'approved';
      reason: string;
      evidenceIds: readonly string[];
      inputDigest: `sha256:${string}`;
      requestId?: string;
      proposalDigest?: `sha256:${string}`;
      work?: WorkDescriptor;
    }
  | {
      kind: 'open-workspace-intent-selected';
      intent: ExecutionWorkspaceIntent;
      requestId: string;
      proposalDigest: `sha256:${string}`;
      actorId: string;
    }
  | {
      kind: 'design-work-ready';
      work: WorkDescriptor;
    }
  | {
      kind: 'planning-semantic-drift';
      reason: string;
      evidenceIds: readonly string[];
      inputDigest: `sha256:${string}`;
    }
  | {
      kind: 'design-gate';
      result: 'blocked' | 'waiting' | 'approved';
      reason: string;
      evidenceIds: readonly string[];
      inputDigest: `sha256:${string}`;
      requestId?: string;
      proposalDigest?: `sha256:${string}`;
      tasks?: readonly SpecificationTask[];
      work?: WorkDescriptor;
      buildProtocol?: BuildProtocolState;
    }
  | {
      kind: 'build-configuration-proposed';
      proposal: BuildConfigurationProposal;
      requestId: string;
      reason: string;
    }
  | {
      kind: 'build-configuration-retry-required';
      reason: string;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-configuration-decision';
      decision: 'approve' | 'reject';
      requestId: string;
      proposalDigest: `sha256:${string}`;
      actorId: string;
      configuration?: BuildConfiguration;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-plan-accepted';
      plan: BuildPlan;
    }
  | {
      kind: 'build-plan-retry-required';
      reason: string;
      work: WorkDescriptor;
    }
  | {
      kind: 'work-execution-migration-required';
      reason: string;
      evidenceIds: readonly string[];
    }
  | {
      kind: 'build-plan-evidence-accepted';
      evidence: PlanEvidence;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-plan-approval-required';
      evidence: PlanEvidence;
      requestId: string;
      reason: string;
    }
  | {
      kind: 'build-plan-decision';
      decision: 'approve' | 'reject';
      requestId: string;
      proposalDigest: `sha256:${string}`;
      actorId: string;
      evidence: PlanEvidence;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-package-completed';
      completion: PackageCompletionEvidence;
      work: WorkDescriptor;
      tasks: readonly SpecificationTask[];
    }
  | {
      kind: 'build-check-accepted';
      evidence: BuildCheckEvidence;
      verificationInput: VerificationInput;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-check-rejected';
      evidence: BuildCheckEvidence;
      invalidation: BuildInvalidation;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-design-revision-required';
      requestId: string;
      proposalDigest: `sha256:${string}`;
      reason: string;
      evidenceIds: readonly string[];
    }
  | {
      kind: 'build-design-revision-decision';
      decision: 'approve' | 'reject';
      requestId: string;
      proposalDigest: `sha256:${string}`;
      actorId: string;
      work?: WorkDescriptor;
    }
  | {
      kind: 'build-retry-exhausted';
      workId: string;
      attempt: number;
      reason: string;
    }
  | {
      kind: 'verify-gate-satisfied';
      workId: string;
      inputDigest: `sha256:${string}`;
      attemptId: string;
      bundleId: string;
      evidenceInputFingerprint: string;
      checkEpoch: number;
    }
  | {
      kind: 'verify-gate-rejected';
      workId: string;
      inputDigest: `sha256:${string}`;
      evidenceInputFingerprint: string;
      attemptId: string;
      bundleId: string | null;
      reason: string;
      result: 'implementation-failure' | 'evidence-unavailable';
      checkEpoch: number;
      tasks?: readonly SpecificationTask[];
      invalidation?: BuildInvalidation;
      work: WorkDescriptor;
      verificationInput?: VerificationInput;
    }
  | {
      kind: 'archive-reverify-required';
      reason: string;
      verificationInput: VerificationInput;
      work: WorkDescriptor;
    }
  | {
      kind: 'archive-preflight-ready';
      archiveInput: ArchiveDeliveryInput;
      work: WorkDescriptor;
    }
  | {
      kind: 'archive-specification-closed';
      closure: SpecificationClosureResult;
      work: WorkDescriptor;
    }
  | {
      kind: 'archive-intent-corrected';
      priorArchiveInputDigest: `sha256:${string}`;
      archiveInput: ArchiveDeliveryInput;
      closure: SpecificationClosureResult;
      work: WorkDescriptor;
      reason: string;
    }
  | {
      kind: 'archive-planning-drift';
      work: WorkDescriptor;
      observedPlanningDigest: `sha256:${string}`;
      reason: string;
      evidenceIds: readonly string[];
    }
  | {
      kind: 'archive-work-restored';
      work: WorkDescriptor;
      reason: string;
    }
  | {
      kind: 'archive-publication-receipt-accepted';
      receipt: PublicationReceipt;
    }
  | {
      kind: 'archive-publication-blocked';
      reason: string;
      evidenceIds: readonly string[];
    };

export interface ChangeLifecycleReduction {
  snapshot: ChangeLifecycleSnapshot;
  fact: ChangeLifecycleTransitionFact | null;
}

const phaseSet = new Set<string>(CHANGE_PHASES);
const statusSet = new Set<string>(CHANGE_RUN_STATUSES);
const blockerStatuses = new Set<RunStatus>(['blocked', 'failed', 'migration_required']);

export function assertChangeLifecycleSnapshot(
  snapshot: ChangeLifecycleSnapshot,
): asserts snapshot is ChangeLifecycleSnapshot {
  if (!phaseSet.has(snapshot.phase)) throw new Error(`Unknown Change phase: ${snapshot.phase}`);
  if (!statusSet.has(snapshot.status))
    throw new Error(`Unknown Change Run status: ${snapshot.status}`);
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new Error('Change lifecycle revision must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(snapshot.checkEpoch) || snapshot.checkEpoch < 0) {
    throw new Error('Change lifecycle checkEpoch must be a non-negative safe integer');
  }
  if (snapshot.currentWork && snapshot.currentWork.phase !== snapshot.phase) {
    throw new Error('Current Work phase does not match the Change phase');
  }
  if (snapshot.currentWork && snapshot.currentWork.checkEpoch !== snapshot.checkEpoch) {
    throw new Error('Current Work checkEpoch does not match the Change lifecycle');
  }
  if (snapshot.currentWork?.taskId) {
    const task = snapshot.tasks?.find(
      (candidate) => candidate.taskId === snapshot.currentWork?.taskId,
    );
    if (!task || task.taskRevision !== snapshot.currentWork.taskRevision) {
      throw new Error('Current Work does not match the persisted Task revision');
    }
  }
  if (
    snapshot.workspaceIntent &&
    (snapshot.workspaceIntent.workspaceId !== snapshot.identity.workspaceId ||
      snapshot.workspaceIntent.changeId !== snapshot.identity.changeId ||
      !/^sha256:[a-f0-9]{64}$/u.test(snapshot.workspaceIntent.semanticDigest))
  ) {
    throw new Error('Execution Workspace intent does not match the Change Run identity');
  }
  if (
    snapshot.buildProtocol &&
    (!['build', 'verify', 'archive'].includes(snapshot.phase) ||
      snapshot.buildProtocol.runId !== snapshot.identity.runId ||
      snapshot.buildProtocol.workspaceIntent.semanticDigest !==
        snapshot.workspaceIntent?.semanticDigest)
  ) {
    throw new Error('Build protocol state does not match the Change Run');
  }
  if (
    snapshot.phase === 'verify' &&
    ((snapshot.verificationInput && !snapshot.currentWork) ||
      (!snapshot.verificationInput && snapshot.currentWork) ||
      (snapshot.verificationInput &&
        snapshot.currentWork &&
        (snapshot.currentWork.inputDigest !== snapshot.verificationInput.digest ||
          snapshot.currentWork.checkEpoch !== snapshot.verificationInput.checkEpoch)))
  ) {
    throw new Error('Verify phase requires a Work bound to the immutable verification input');
  }
  if (
    snapshot.verificationInvalidation &&
    (snapshot.phase !== 'build' ||
      snapshot.currentWork?.kind !== 'build.plan' ||
      snapshot.verificationInput)
  ) {
    throw new Error(
      'Verification invalidation requires an active Build Plan revision without input',
    );
  }
  if (snapshot.status === 'waiting' && snapshot.waitCondition === null) {
    throw new Error('Waiting Change Run requires a durable WaitCondition');
  }
  if (snapshot.status !== 'waiting' && snapshot.waitCondition !== null) {
    throw new Error('Only a waiting Change Run may carry a WaitCondition');
  }
  if (blockerStatuses.has(snapshot.status) && snapshot.blocker === null) {
    throw new Error(`${snapshot.status} Change Run requires a blocker`);
  }
  if (!blockerStatuses.has(snapshot.status) && snapshot.blocker !== null) {
    throw new Error(`${snapshot.status} Change Run may not carry a blocker`);
  }
  if (
    snapshot.status === 'completed' &&
    (snapshot.phase !== 'archive' || snapshot.currentWork !== null)
  ) {
    throw new Error('A completed Change Run must finish in Archive with no current Work');
  }
}

export function applyChangeLifecycleTransition(options: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  transitionId: string;
  next: {
    currentWork: WorkDescriptor | null;
    waitCondition: WaitCondition | null;
    blocker: ChangeRunBlocker | null;
    tasks?: readonly SpecificationTask[];
    workspaceIntent?: ExecutionWorkspaceIntent | null;
    buildProtocol?: BuildProtocolState | null;
    openApprovalDigest?: `sha256:${string}` | null;
    planningDigest?: `sha256:${string}` | null;
    adoptedCompletionClaimDigest?: `sha256:${string}` | null;
    verificationInput?: VerificationInput | null;
    verificationInvalidation?: VerificationInvalidation | null;
    archiveDeliveryInput?: ArchiveDeliveryInput | null;
    specificationClosure?: SpecificationClosureResult | null;
    publicationReceipt?: PublicationReceipt | null;
  };
}): { snapshot: ChangeLifecycleSnapshot; fact: ChangeLifecycleTransitionFact } {
  assertChangeLifecycleSnapshot(options.current);
  if (
    options.current.definition.id !== options.definition.id ||
    options.current.definition.version !== options.definition.version
  ) {
    throw new Error('Change lifecycle definition identity does not match the Run snapshot');
  }
  const matches = options.definition.transitions.filter(
    (candidate) => candidate.id === options.transitionId,
  );
  if (matches.length !== 1) {
    throw new Error(`Lifecycle transition must resolve exactly once: ${options.transitionId}`);
  }
  const transition = matches[0]!;
  if (
    transition.from.phase !== options.current.phase ||
    !transition.from.statuses.includes(options.current.status)
  ) {
    throw new Error(
      `Lifecycle transition ${transition.id} is not valid from ${options.current.phase}/${options.current.status}`,
    );
  }
  if (!options.definition.phases.some((entry) => entry.phase === transition.to.phase)) {
    throw new Error(`Lifecycle transition ${transition.id} targets an undeclared phase`);
  }
  if (options.current.checkEpoch === Number.MAX_SAFE_INTEGER) {
    throw new Error('Change lifecycle checkEpoch cannot overflow');
  }
  const snapshot: ChangeLifecycleSnapshot = {
    ...structuredClone(options.current),
    revision: options.current.revision + 1,
    checkEpoch: options.current.checkEpoch + 1,
    phase: transition.to.phase,
    status: transition.to.status,
    currentWork: structuredClone(options.next.currentWork),
    waitCondition: structuredClone(options.next.waitCondition),
    blocker: structuredClone(options.next.blocker),
    ...(options.next.tasks ? { tasks: structuredClone(options.next.tasks) } : {}),
  };
  if (options.next.workspaceIntent === null) delete snapshot.workspaceIntent;
  else if (options.next.workspaceIntent) {
    snapshot.workspaceIntent = structuredClone(options.next.workspaceIntent);
  }
  if (options.next.buildProtocol === null) delete snapshot.buildProtocol;
  else if (options.next.buildProtocol) {
    snapshot.buildProtocol = structuredClone(options.next.buildProtocol);
  }
  if (options.next.planningDigest === null) delete snapshot.planningDigest;
  else if (options.next.planningDigest) snapshot.planningDigest = options.next.planningDigest;
  if (options.next.adoptedCompletionClaimDigest === null) {
    delete snapshot.adoptedCompletionClaimDigest;
  } else if (options.next.adoptedCompletionClaimDigest) {
    snapshot.adoptedCompletionClaimDigest = options.next.adoptedCompletionClaimDigest;
  }
  if (options.next.openApprovalDigest === null) delete snapshot.openApprovalDigest;
  else if (options.next.openApprovalDigest) {
    snapshot.openApprovalDigest = options.next.openApprovalDigest;
  }
  if (options.next.verificationInput === null) delete snapshot.verificationInput;
  else if (options.next.verificationInput) {
    snapshot.verificationInput = structuredClone(options.next.verificationInput);
  }
  if (options.next.verificationInvalidation === null) delete snapshot.verificationInvalidation;
  else if (options.next.verificationInvalidation) {
    snapshot.verificationInvalidation = structuredClone(options.next.verificationInvalidation);
  }
  if (options.next.archiveDeliveryInput === null) delete snapshot.archiveDeliveryInput;
  else if (options.next.archiveDeliveryInput) {
    snapshot.archiveDeliveryInput = structuredClone(options.next.archiveDeliveryInput);
  }
  if (options.next.specificationClosure === null) delete snapshot.specificationClosure;
  else if (options.next.specificationClosure) {
    snapshot.specificationClosure = structuredClone(options.next.specificationClosure);
  }
  if (options.next.publicationReceipt === null) delete snapshot.publicationReceipt;
  else if (options.next.publicationReceipt) {
    snapshot.publicationReceipt = structuredClone(options.next.publicationReceipt);
  }
  assertChangeLifecycleSnapshot(snapshot);
  return {
    snapshot,
    fact: {
      schemaVersion: 2,
      transitionId: transition.id,
      definition: structuredClone(snapshot.definition),
      revision: snapshot.revision,
      from: {
        phase: options.current.phase,
        status: options.current.status,
        checkEpoch: options.current.checkEpoch,
      },
      to: { phase: snapshot.phase, status: snapshot.status, checkEpoch: snapshot.checkEpoch },
      workId: snapshot.currentWork?.workId ?? null,
      waitId: snapshot.waitCondition?.waitId ?? null,
      work: snapshot.currentWork
        ? {
            workId: snapshot.currentWork.workId,
            kind: snapshot.currentWork.kind,
            ...(snapshot.currentWork.taskId ? { taskId: snapshot.currentWork.taskId } : {}),
            validatorProfile: structuredClone(snapshot.currentWork.validatorProfile),
          }
        : null,
      wait: snapshot.waitCondition
        ? { waitId: snapshot.waitCondition.waitId, kind: snapshot.waitCondition.kind }
        : null,
    },
  };
}

export function evolveChangeLifecycle(options: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  observation: ChangeLifecycleObservation;
}): ChangeLifecycleReduction {
  const { current, observation } = options;
  if (observation.kind === 'open-work-ready') {
    if (
      current.phase !== 'open' ||
      !['running', 'waiting', 'blocked'].includes(current.status) ||
      current.currentWork !== null ||
      observation.work.phase !== 'open' ||
      observation.work.kind !== 'change.intake'
    ) {
      throw new Error(`Open Work dispatch is not valid from ${current.phase}/${current.status}`);
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'open.work-ready',
      next: { currentWork: observation.work, waitCondition: null, blocker: null },
    });
  }
  if (observation.kind === 'open-workspace-intent-selected') {
    const wait = current.waitCondition;
    if (
      current.phase !== 'open' ||
      current.status !== 'waiting' ||
      wait?.kind !== 'human-decision' ||
      wait.requestId !== observation.requestId ||
      wait.proposalDigest !== observation.proposalDigest ||
      observation.intent.workspaceId !== current.identity.workspaceId ||
      observation.intent.changeId !== current.identity.changeId ||
      !observation.actorId.trim()
    ) {
      throw new Error('Workspace intent selection does not match the Open Human Decision');
    }
    if (current.workspaceIntent) {
      if (current.workspaceIntent.semanticDigest !== observation.intent.semanticDigest) {
        throw new Error('Open approval cannot replace the selected Workspace intent');
      }
      return { snapshot: structuredClone(current), fact: null };
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'open.intent-selected',
      next: {
        currentWork: null,
        waitCondition: wait,
        blocker: null,
        workspaceIntent: observation.intent,
      },
    });
  }
  if (observation.kind === 'open-gate') {
    if (current.phase !== 'open' || !['running', 'waiting', 'blocked'].includes(current.status)) {
      throw new Error(`Open gate is not valid from ${current.phase}/${current.status}`);
    }
    if (observation.result === 'approved') {
      if (!current.workspaceIntent) {
        throw new Error('Approved Open gate requires a trusted Execution Workspace intent');
      }
      if (
        !observation.work ||
        observation.work.phase !== 'design' ||
        observation.work.kind !== 'specification.plan'
      ) {
        throw new Error('Approved Open gate requires the Runtime-selected Design Work');
      }
      return applyChangeLifecycleTransition({
        definition: options.definition,
        current,
        transitionId: 'open.approved',
        next: {
          currentWork: observation.work,
          waitCondition: null,
          blocker: null,
          openApprovalDigest: observation.inputDigest,
        },
      });
    }
    if (observation.result === 'waiting') {
      if (!observation.requestId?.trim() || !observation.proposalDigest) {
        throw new Error('Waiting Open gate requires a Human Decision request identity');
      }
      const waitCondition: HumanDecisionWaitCondition = {
        schemaVersion: 1,
        waitId: `open-approval:${observation.requestId}`,
        kind: 'human-decision',
        reason: observation.reason,
        inputDigest: observation.inputDigest,
        requestId: observation.requestId,
        proposalDigest: observation.proposalDigest,
      };
      if (
        current.status === 'waiting' &&
        current.waitCondition?.kind === 'human-decision' &&
        current.waitCondition.waitId === waitCondition.waitId &&
        current.waitCondition.inputDigest === waitCondition.inputDigest
      ) {
        return { snapshot: structuredClone(current), fact: null };
      }
      return applyChangeLifecycleTransition({
        definition: options.definition,
        current,
        transitionId: 'open.await-approval',
        next: { currentWork: null, waitCondition, blocker: null, openApprovalDigest: null },
      });
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'open.invalid',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: {
          code: 'open.planning-invalid',
          message: observation.reason,
          evidenceIds: [...observation.evidenceIds],
          sinceRevision: current.revision + 1,
        },
        openApprovalDigest: null,
      },
    });
  }
  if (observation.kind === 'planning-semantic-drift') {
    if (current.phase !== 'build' && current.phase !== 'verify') {
      throw new Error(
        `Planning semantic drift is not valid from ${current.phase}/${current.status}`,
      );
    }
    if (!current.planningDigest) {
      throw new Error('Active Build or Verify Work has no approved planning digest');
    }
    const supersededPlanningDigest = current.planningDigest;
    const supersededWorkId = current.currentWork?.workId ?? null;
    const supersededTaskRevisions = (current.tasks ?? []).map((task) => task.taskRevision).sort();
    const reduced = applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId:
        current.phase === 'build' ? 'build.semantic-plan-drift' : 'verify.semantic-plan-drift',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
        tasks: [],
        buildProtocol: null,
        planningDigest: null,
        verificationInput: null,
        verificationInvalidation: null,
      },
    });
    reduced.fact.invalidation = {
      kind: 'planning-semantic-drift',
      supersededPlanningDigest,
      observedPlanningDigest: observation.inputDigest,
      supersededWorkId,
      supersededTaskRevisions,
      evidenceIds: [...observation.evidenceIds],
    };
    return reduced;
  }
  if (observation.kind === 'design-work-ready') {
    if (
      current.phase !== 'design' ||
      !['running', 'waiting', 'blocked'].includes(current.status) ||
      current.currentWork !== null ||
      observation.work.phase !== 'design' ||
      observation.work.kind !== 'specification.plan'
    ) {
      throw new Error(`Design Work dispatch is not valid from ${current.phase}/${current.status}`);
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'design.work-ready',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
      },
    });
  }
  if (observation.kind === 'build-configuration-proposed') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'build.configure' ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'configure'
    ) {
      throw new Error('Build Configuration proposal requires the active Configure Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'configuration-proposed',
      proposal: observation.proposal,
    });
    const waitCondition: HumanDecisionWaitCondition = {
      schemaVersion: 1,
      kind: 'human-decision',
      waitId: `build-configuration:${observation.requestId}`,
      requestId: observation.requestId,
      proposalDigest: observation.proposal.semanticDigest,
      inputDigest: observation.proposal.semanticDigest,
      reason: observation.reason,
    };
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.configuration-awaiting-approval',
      next: {
        currentWork: null,
        waitCondition,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-configuration-retry-required') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      (current.currentWork !== null && current.currentWork.kind !== 'build.configure') ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'configure' ||
      observation.work.phase !== 'build' ||
      observation.work.kind !== 'build.configure' ||
      !observation.reason.trim()
    ) {
      throw new Error('Build Configuration retry requires the active Configure Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'retry',
      action: 'configure',
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.configuration-retry',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-configuration-decision') {
    const wait = current.waitCondition;
    if (
      current.phase !== 'build' ||
      current.status !== 'waiting' ||
      wait?.kind !== 'human-decision' ||
      !wait.waitId.startsWith('build-configuration:') ||
      wait.requestId !== observation.requestId ||
      wait.proposalDigest !== observation.proposalDigest ||
      !current.buildProtocol ||
      !observation.actorId.trim()
    ) {
      throw new Error('Build Configuration decision does not match the current proposal');
    }
    if (observation.decision === 'approve') {
      if (!observation.configuration || observation.work.kind !== 'build.plan') {
        throw new Error('Approved Build Configuration requires Runtime-selected Plan Work');
      }
      const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
        kind: 'configuration-approved',
        configuration: observation.configuration,
      });
      return applyChangeLifecycleTransition({
        definition: options.definition,
        current,
        transitionId: 'build.configuration-approved',
        next: {
          currentWork: observation.work,
          waitCondition: null,
          blocker: null,
          buildProtocol,
        },
      });
    }
    if (observation.work.kind !== 'build.configure') {
      throw new Error('Rejected Build Configuration requires another Configure Work');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'retry',
      action: 'configure',
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.configuration-rejected',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-plan-retry-required') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      (current.currentWork !== null && current.currentWork.kind !== 'build.plan') ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'plan' ||
      observation.work.phase !== 'build' ||
      observation.work.kind !== 'build.plan' ||
      !observation.reason.trim()
    ) {
      throw new Error('Build Plan retry requires the active Plan Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'retry',
      action: 'plan',
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.plan-retry',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'work-execution-migration-required') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      !['build.plan', 'build.check'].includes(current.currentWork?.kind ?? '') ||
      !observation.reason.trim()
    ) {
      throw new Error('Work execution migration is not valid from the current lifecycle state');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId:
        current.currentWork?.kind === 'build.check'
          ? 'build.check-work-execution-migration-required'
          : 'build.work-execution-migration-required',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: {
          code: 'work-execution.migration-required',
          message: observation.reason,
          evidenceIds: [...observation.evidenceIds],
          sinceRevision: current.revision + 1,
        },
      },
    });
  }
  if (observation.kind === 'build-plan-accepted') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'build.plan' ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'plan'
    ) {
      throw new Error('Accepted Build Plan does not match the active Plan Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'plan-accepted',
      plan: observation.plan,
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.plan-accepted',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-plan-evidence-accepted') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork !== null ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'plan-evidence'
    ) {
      throw new Error('Plan Evidence does not match the active Runtime validator Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'plan-evidence-accepted',
      evidence: observation.evidence,
    });
    const expectedKind = buildProtocol.currentAction === 'check' ? 'build.check' : 'build.execute';
    if (observation.work.kind !== expectedKind) {
      throw new Error('Plan Evidence produced a Work outside the Runtime-selected Action');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.plan-evidence-accepted',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-plan-approval-required') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork !== null ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'plan-evidence' ||
      observation.evidence.risk.level !== 'high' ||
      observation.evidence.planDigest !== current.buildProtocol.plan?.digest
    ) {
      throw new Error('Plan approval wait does not match the active Plan Evidence');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.plan-approval-required',
      next: {
        currentWork: null,
        waitCondition: {
          schemaVersion: 1,
          kind: 'human-decision',
          waitId: `build-plan:${observation.requestId}`,
          requestId: observation.requestId,
          proposalDigest: observation.evidence.validationDigest,
          inputDigest: observation.evidence.validationDigest,
          reason: observation.reason,
        },
        blocker: null,
      },
    });
  }
  if (observation.kind === 'build-plan-decision') {
    const wait = current.waitCondition;
    if (
      current.phase !== 'build' ||
      current.status !== 'waiting' ||
      wait?.kind !== 'human-decision' ||
      !wait.waitId.startsWith('build-plan:') ||
      wait.requestId !== observation.requestId ||
      wait.proposalDigest !== observation.proposalDigest ||
      observation.evidence.validationDigest !== observation.proposalDigest ||
      !current.buildProtocol ||
      !observation.actorId.trim()
    ) {
      throw new Error('Plan decision does not match the active Human Decision');
    }
    const buildProtocol = advanceBuildProtocol(
      current.buildProtocol,
      observation.decision === 'approve'
        ? { kind: 'plan-evidence-accepted', evidence: observation.evidence }
        : { kind: 'plan-rejected' },
    );
    const expectedKind =
      observation.decision === 'approve'
        ? buildProtocol.currentAction === 'check'
          ? 'build.check'
          : 'build.execute'
        : 'build.plan';
    if (observation.work.kind !== expectedKind) {
      throw new Error('Plan decision Work does not match the Runtime-selected Action');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId:
        observation.decision === 'approve' ? 'build.plan-approved' : 'build.plan-rejected',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-package-completed') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'build.execute' ||
      current.currentWork.packageId !== observation.completion.packageId ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'execute'
    ) {
      throw new Error('Package completion does not match the active Execute Work');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'package-completed',
      completion: observation.completion,
    });
    const expectedKind = buildProtocol.currentAction === 'check' ? 'build.check' : 'build.execute';
    if (observation.work.kind !== expectedKind) {
      throw new Error('Runtime-selected Work does not match the next Build Action');
    }
    const previousTasks = current.tasks ?? [];
    if (
      observation.tasks.length !== previousTasks.length ||
      observation.tasks.some((task, index) => {
        const previous = previousTasks[index];
        return (
          !previous ||
          task.taskId !== previous.taskId ||
          task.taskRevision !== previous.taskRevision ||
          (previous.status === 'completed' && task.status !== 'completed')
        );
      })
    ) {
      throw new Error('Package completion changed the approved Task authority');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.package-completed',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        tasks: observation.tasks,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-check-accepted') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'build.check' ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'check' ||
      observation.work.kind !== 'evidence.verify' ||
      observation.work.inputDigest !== observation.verificationInput.digest
    ) {
      throw new Error('Build Check acceptance does not match the active Check Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'check-accepted',
      evidence: observation.evidence,
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.validated',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
        verificationInput: observation.verificationInput,
        verificationInvalidation: null,
      },
    });
  }
  if (observation.kind === 'build-check-rejected') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'build.check' ||
      observation.evidence.accepted ||
      observation.work.kind !== 'build.plan' ||
      !current.buildProtocol ||
      current.buildProtocol.currentAction !== 'check'
    ) {
      throw new Error('Build Check rejection does not match the active Check Action');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'revision-required',
      invalidation: observation.invalidation,
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.check-rejected',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    });
  }
  if (observation.kind === 'build-design-revision-required') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      !current.currentWork ||
      !observation.reason.trim()
    ) {
      throw new Error('Design revision request requires an active Build Work');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.design-revision-required',
      next: {
        currentWork: null,
        waitCondition: {
          schemaVersion: 1,
          kind: 'human-decision',
          waitId: `build-design:${observation.requestId}`,
          requestId: observation.requestId,
          proposalDigest: observation.proposalDigest,
          inputDigest: observation.proposalDigest,
          reason: observation.reason,
        },
        blocker: null,
      },
    });
  }
  if (observation.kind === 'build-design-revision-decision') {
    const wait = current.waitCondition;
    if (
      current.phase !== 'build' ||
      current.status !== 'waiting' ||
      wait?.kind !== 'human-decision' ||
      !wait.waitId.startsWith('build-design:') ||
      wait.requestId !== observation.requestId ||
      wait.proposalDigest !== observation.proposalDigest ||
      !observation.actorId.trim()
    ) {
      throw new Error('Design revision decision does not match the active Build wait');
    }
    if (observation.decision === 'approve') {
      if (observation.work?.phase !== 'design' || observation.work.kind !== 'specification.plan') {
        throw new Error('Approved Design revision requires Runtime-selected Design Work');
      }
      return applyChangeLifecycleTransition({
        definition: options.definition,
        current,
        transitionId: 'build.design-revision-approved',
        next: {
          currentWork: observation.work,
          waitCondition: null,
          blocker: null,
          tasks: [],
          buildProtocol: null,
          planningDigest: null,
          adoptedCompletionClaimDigest: null,
          verificationInput: null,
          verificationInvalidation: null,
        },
      });
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.design-revision-rejected',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: {
          code: 'build.design-revision-rejected',
          message: 'Design revision was rejected by the Human Decision',
          evidenceIds: [observation.proposalDigest],
          sinceRevision: current.revision + 1,
        },
      },
    });
  }
  if (observation.kind === 'build-retry-exhausted') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork?.workId !== observation.workId ||
      observation.attempt < 1
    ) {
      throw new Error('Build retry exhaustion does not match the active Work');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.retry-exhausted',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: {
          code: 'build.retry-exhausted',
          message: observation.reason,
          evidenceIds: [`attempt:${observation.attempt}`],
          sinceRevision: current.revision + 1,
        },
      },
    });
  }
  if (observation.kind === 'verify-gate-satisfied') {
    if (current.phase !== 'verify' || current.status !== 'running') {
      throw new Error(`Verify Gate is not valid from ${current.phase}/${current.status}`);
    }
    const work = current.currentWork;
    const verification = current.verificationInput;
    if (
      !work ||
      work.kind !== 'evidence.verify' ||
      work.workId !== observation.workId ||
      work.inputDigest !== observation.inputDigest ||
      !verification ||
      verification.digest !== observation.inputDigest ||
      verification.evidenceProfile.fingerprintDigest !== observation.evidenceInputFingerprint
    ) {
      throw new Error('Satisfied Verify Gate does not match the active verification input');
    }
    if (!observation.attemptId.trim() || !observation.bundleId.trim()) {
      throw new Error('Satisfied Verify Gate requires Evidence attempt and Bundle identities');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'verify.satisfied',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
      },
    });
  }
  if (observation.kind === 'verify-gate-rejected') {
    if (current.phase !== 'verify' || !['running', 'blocked'].includes(current.status)) {
      throw new Error(`Verify rejection is not valid from ${current.phase}/${current.status}`);
    }
    const work = current.currentWork;
    const verification = current.verificationInput;
    if (
      !work ||
      work.kind !== 'evidence.verify' ||
      work.workId !== observation.workId ||
      work.inputDigest !== observation.inputDigest ||
      !verification ||
      verification.digest !== observation.inputDigest
    ) {
      throw new Error('Verify rejection does not match the active verification input');
    }
    if (!observation.attemptId.trim() || !observation.reason.trim()) {
      throw new Error('Verify rejection requires Attempt identity and reason');
    }
    if (observation.checkEpoch !== current.checkEpoch) {
      throw new Error('Verify rejection belongs to a stale checkEpoch');
    }
    if (observation.result === 'evidence-unavailable') {
      const retryInput = observation.verificationInput;
      if (
        !retryInput ||
        observation.work.phase !== 'verify' ||
        observation.work.kind !== 'evidence.verify' ||
        observation.work.inputDigest !== retryInput.digest ||
        retryInput.runId !== verification.runId
      ) {
        throw new Error('Evidence retry must recreate the active Verify Work');
      }
      return applyChangeLifecycleTransition({
        definition: options.definition,
        current,
        transitionId: 'verify.retry',
        next: {
          currentWork: observation.work,
          waitCondition: null,
          blocker: null,
          verificationInput: retryInput,
        },
      });
    }
    if (
      observation.work.phase !== 'build' ||
      observation.work.kind !== 'build.plan' ||
      !observation.invalidation ||
      !current.buildProtocol ||
      !observation.tasks ||
      canonicalJson(
        observation.tasks.map(({ taskId, taskRevision, status }) => ({
          taskId,
          taskRevision,
          status,
        })),
      ) !==
        canonicalJson(
          (current.tasks ?? []).map(({ taskId, taskRevision, status }) => ({
            taskId,
            taskRevision,
            status,
          })),
        )
    ) {
      throw new Error('Implementation failure requires a Runtime-selected Build Plan revision');
    }
    const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
      kind: 'revision-required',
      invalidation: observation.invalidation,
    });
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'verify.failed',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        tasks: observation.tasks,
        buildProtocol,
        verificationInput: null,
        verificationInvalidation: {
          schemaVersion: 1,
          kind: 'implementation-drift',
          priorInputDigest: observation.inputDigest,
          evidenceInputFingerprint: observation.evidenceInputFingerprint,
          attemptId: observation.attemptId,
          bundleId: observation.bundleId,
          reason: observation.reason,
        },
      },
    });
  }
  if (observation.kind === 'archive-reverify-required') {
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork !== null ||
      current.archiveDeliveryInput ||
      current.specificationClosure ||
      current.publicationReceipt ||
      observation.work.phase !== 'verify' ||
      observation.work.kind !== 'evidence.verify' ||
      observation.work.inputDigest !== observation.verificationInput.digest
    ) {
      throw new Error('Archive may reverify only before closure or publication side effects');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.reverify',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        verificationInput: observation.verificationInput,
      },
    });
  }
  if (observation.kind === 'archive-preflight-ready') {
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork !== null
    ) {
      throw new Error(`Archive preflight is not valid from ${current.phase}/${current.status}`);
    }
    if (
      observation.work.phase !== 'archive' ||
      observation.work.kind !== 'specification.close' ||
      observation.work.inputDigest !== observation.archiveInput.digest ||
      observation.archiveInput.runId !== current.identity.runId ||
      observation.archiveInput.changeId !== current.identity.changeId
    ) {
      throw new Error('Archive preflight Work does not match its immutable input');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.preflight-ready',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        archiveDeliveryInput: observation.archiveInput,
      },
    });
  }
  if (observation.kind === 'archive-specification-closed') {
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'specification.close' ||
      !current.archiveDeliveryInput
    ) {
      throw new Error(`Specification closure is not valid from ${current.phase}/${current.status}`);
    }
    if (
      observation.closure.changeId !== current.identity.changeId ||
      observation.closure.status !== 'closed' ||
      observation.work.phase !== 'archive' ||
      observation.work.kind !== 'delivery.publish'
    ) {
      throw new Error('Specification Closure Receipt does not match the active Archive');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.specification-closed',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        specificationClosure: observation.closure,
      },
    });
  }
  if (observation.kind === 'archive-intent-corrected') {
    const stableArchiveIdentity = (archive: ArchiveDeliveryInput) => ({
      runId: archive.runId,
      changeId: archive.changeId,
      verificationInputDigest: archive.verificationInputDigest,
      evidenceBundleId: archive.evidenceBundleId,
      verificationReport: archive.verificationReport,
      changeBranch: { ...archive.changeBranch, remoteOid: '<corrected>' },
      businessDeliveries: archive.businessDeliveries,
      businessSplitReason: archive.businessSplitReason,
      publicationPolicyDigest: archive.publicationPolicyDigest,
      actionAuthorization: archive.actionAuthorization,
    });
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'delivery.publish' ||
      !current.archiveDeliveryInput ||
      !current.specificationClosure ||
      current.publicationReceipt ||
      observation.priorArchiveInputDigest !== current.archiveDeliveryInput.digest ||
      observation.closure.closureId !== current.specificationClosure.closureId ||
      observation.work.phase !== 'archive' ||
      observation.work.kind !== 'delivery.publish' ||
      observation.work.inputDigest === current.currentWork.inputDigest ||
      observation.archiveInput.runId !== current.identity.runId ||
      observation.archiveInput.changeId !== current.identity.changeId ||
      observation.archiveInput.changeBranch.remoteOid !==
        current.specificationClosure.candidate.baseOid ||
      observation.archiveInput.changeBranch.remoteOid ===
        current.archiveDeliveryInput.changeBranch.remoteOid ||
      canonicalJson(stableArchiveIdentity(observation.archiveInput)) !==
        canonicalJson(stableArchiveIdentity(current.archiveDeliveryInput)) ||
      !observation.reason.trim()
    ) {
      throw new Error('Archive intent correction is not valid for the active publication Work');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.intent-corrected',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        archiveDeliveryInput: observation.archiveInput,
      },
    });
  }
  if (observation.kind === 'archive-planning-drift') {
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'delivery.publish' ||
      !current.archiveDeliveryInput ||
      !current.specificationClosure ||
      current.publicationReceipt ||
      observation.work.phase !== 'design' ||
      observation.work.kind !== 'specification.plan' ||
      !observation.reason.trim()
    ) {
      throw new Error('Archive planning drift is not valid before the publication boundary');
    }
    const reduced = applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.planning-drift',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        tasks: [],
        planningDigest: null,
        verificationInput: null,
        verificationInvalidation: null,
        archiveDeliveryInput: null,
        specificationClosure: null,
      },
    });
    reduced.fact.invalidation = {
      kind: 'planning-semantic-drift',
      supersededPlanningDigest: current.planningDigest ?? current.archiveDeliveryInput.digest,
      observedPlanningDigest: observation.observedPlanningDigest,
      supersededWorkId: current.currentWork.workId,
      supersededTaskRevisions: (current.tasks ?? []).map((task) => task.taskRevision).sort(),
      evidenceIds: [...observation.evidenceIds],
    };
    return reduced;
  }
  if (observation.kind === 'archive-work-restored') {
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork !== null ||
      !current.archiveDeliveryInput ||
      !current.specificationClosure ||
      current.publicationReceipt ||
      observation.work.phase !== 'archive' ||
      observation.work.kind !== 'delivery.publish' ||
      !observation.reason.trim()
    ) {
      throw new Error('Archive Work restoration is not valid for the recovered lifecycle');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.work-restored',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
      },
    });
  }
  if (observation.kind === 'archive-publication-receipt-accepted') {
    if (
      current.phase === 'archive' &&
      current.status === 'completed' &&
      current.publicationReceipt?.digest === observation.receipt.digest
    ) {
      return { snapshot: structuredClone(current), fact: null };
    }
    if (
      current.phase !== 'archive' ||
      current.status !== 'running' ||
      current.currentWork?.kind !== 'delivery.publish' ||
      !current.verificationInput ||
      !current.specificationClosure
    ) {
      throw new Error(
        `Publication completion is not valid from ${current.phase}/${current.status}`,
      );
    }
    assertPublicationReceipt(observation.receipt);
    if (
      observation.receipt.changeId !== current.identity.changeId ||
      observation.receipt.runId !== current.identity.runId ||
      observation.receipt.verificationInputDigest !== current.verificationInput.digest ||
      observation.receipt.specificationClosure.closureId !==
        current.specificationClosure.closureId ||
      observation.receipt.specificationClosure.planDigest !==
        current.specificationClosure.planDigest
    ) {
      throw new Error('Publication Receipt does not match the active Archive inputs');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.completed',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
        publicationReceipt: observation.receipt,
      },
    });
  }
  if (observation.kind === 'archive-publication-blocked') {
    if (
      current.phase !== 'archive' ||
      !['running', 'blocked'].includes(current.status) ||
      current.currentWork?.kind !== 'delivery.publish' ||
      !observation.reason.trim()
    ) {
      throw new Error(`Publication blocking is not valid from ${current.phase}/${current.status}`);
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'archive.publication-blocked',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: {
          code: 'publication-receipt-incomplete',
          message: observation.reason,
          evidenceIds: [...observation.evidenceIds],
          sinceRevision: current.revision,
        },
      },
    });
  }
  if (current.phase !== 'design') {
    throw new Error(`Design gate is not valid from ${current.phase}/${current.status}`);
  }
  if (observation.result === 'approved') {
    if (!observation.tasks || observation.tasks.length === 0) {
      throw new Error('Approved Design gate requires a fixed Task projection');
    }
    if (
      !observation.work ||
      observation.work.kind !== 'build.configure' ||
      !observation.buildProtocol ||
      observation.buildProtocol.currentAction !== 'configure'
    ) {
      throw new Error('Approved Design gate requires Runtime-selected Build Configure');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'design.approved',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        tasks: observation.tasks,
        buildProtocol: observation.buildProtocol,
        planningDigest: observation.inputDigest,
      },
    });
  }
  if (observation.result === 'waiting') {
    if (!observation.requestId?.trim() || !observation.proposalDigest) {
      throw new Error('Waiting Design gate requires a Human Decision request identity');
    }
    const waitCondition: HumanDecisionWaitCondition = {
      schemaVersion: 1,
      waitId: `design-approval:${observation.requestId}`,
      kind: 'human-decision',
      reason: observation.reason,
      inputDigest: observation.inputDigest,
      requestId: observation.requestId,
      proposalDigest: observation.proposalDigest,
    };
    if (
      current.status === 'waiting' &&
      current.waitCondition?.kind === 'human-decision' &&
      current.waitCondition.waitId === waitCondition.waitId &&
      current.waitCondition.inputDigest === waitCondition.inputDigest
    ) {
      return { snapshot: structuredClone(current), fact: null };
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'design.await-approval',
      next: { currentWork: null, waitCondition, blocker: null, planningDigest: null },
    });
  }
  const blocker: ChangeRunBlocker = {
    code: 'design.planning-invalid',
    message: observation.reason,
    evidenceIds: [...observation.evidenceIds],
    sinceRevision: current.revision + 1,
  };
  if (
    current.status === 'blocked' &&
    current.blocker?.code === blocker.code &&
    current.blocker.message === blocker.message &&
    current.blocker.evidenceIds.join('\u0000') === blocker.evidenceIds.join('\u0000')
  ) {
    return { snapshot: structuredClone(current), fact: null };
  }
  return applyChangeLifecycleTransition({
    definition: options.definition,
    current,
    transitionId: 'design.invalid',
    next: {
      // A blocked Design gate has not accepted the Validator boundary. Keep the
      // Runtime-selected Work attached so a later pull retries validation from
      // the persisted Outcome instead of orphaning its authoritative claim.
      currentWork: null,
      waitCondition: null,
      blocker,
      planningDigest: null,
    },
  });
}

export function projectChangeRun(
  snapshot: ChangeLifecycleSnapshot,
  details: {
    taskProgress: ChangeTaskProgress;
    evidence: ChangeEvidenceSummary;
    nextActions: readonly ChangeNextAction[];
    freshness: ChangeRunFreshness;
  },
): ChangeRunProjection {
  assertChangeLifecycleSnapshot(snapshot);
  if (
    details.taskProgress.total < 0 ||
    details.taskProgress.completed < 0 ||
    details.taskProgress.completed > details.taskProgress.total
  ) {
    throw new Error('Change task progress is outside its valid range');
  }
  const protocol = snapshot.buildProtocol;
  const build: ChangeBuildSummary | null = protocol
    ? {
        action: protocol.currentAction,
        actionAttempt: protocol.actionAttempt,
        configurationId: protocol.configuration?.configurationId ?? null,
        executionMode: protocol.configuration?.executionMode ?? null,
        tddMode: protocol.configuration?.tddMode ?? null,
        isolation: protocol.workspaceIntent.isolation,
        planId: protocol.plan?.planId ?? null,
        planRevision: protocol.plan?.revision ?? null,
        packageId: snapshot.currentWork?.packageId ?? null,
        completedPackages: protocol.packageCompletions.length,
        totalPackages: protocol.plan?.packages.length ?? 0,
        checkAccepted: protocol.checkEvidence?.accepted ?? false,
      }
    : null;
  return structuredClone({ ...snapshot, ...details, build });
}
