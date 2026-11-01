import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { createRuntimeIdentity } from '../runtime/identity.js';
import type {
  ChangeBranchReference,
  PlanningSpecificationRoot,
  PlanningSnapshot,
  SpecificationApprovalProposal,
  SpecificationApprovalActor,
  SpecificationApprovalDecisionRequest,
  SpecificationApprovalDecisionResponse,
  SpecificationApprovalRecord,
  SpecificationApprovalState,
  SpecificationApprovalMigrationPlan,
  SpecificationChange,
  SpecificationSchemaInstructions,
  SpecificationValidation,
  SpecificationPlanningManifest,
} from './types.js';
import {
  assertSpecificationPlanningManifest,
  createSpecificationPlanningManifest,
} from './planning-manifest.js';
import { normalizePlanningArtifacts, REQUIRED_PLANNING_ARTIFACTS } from './artifacts.js';

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function assertDigest(value: string, label: string): asserts value is `sha256:${string}` {
  if (!SHA256_DIGEST.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function normalizeBranch(branch: ChangeBranchReference): ChangeBranchReference {
  for (const [field, value] of Object.entries(branch)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Change branch ${field} is required`);
    }
  }
  if (branch.sourceBranch === branch.targetBranch) {
    throw new Error('Change branch source and target branches must differ');
  }
  if (!GIT_OID.test(branch.remoteOid)) {
    throw new Error('Change branch remote OID must be a published Git commit');
  }
  return structuredClone(branch);
}

function planningSnapshotDigest(snapshot: Omit<PlanningSnapshot, 'digest'>): `sha256:${string}` {
  return createRuntimeIdentity('planning-semantic', {
    changeId: snapshot.changeId,
    approvalPhase: snapshot.approvalPhase,
    provider: snapshot.provider,
    schemaDigest: snapshot.schema?.digest,
    specificationRoot: snapshot.specificationRoot,
    changeDigest: snapshot.changeDigest,
    artifacts: snapshot.artifacts,
    affectedCapabilities: snapshot.affectedCapabilities,
    targetBranch: snapshot.changeBranch.targetBranch,
    planningManifestDigest: snapshot.planningManifestDigest,
    planningPolicyDigest: snapshot.planningPolicyDigest,
    buildStrategyDigest: snapshot.buildStrategyDigest,
  }).digest;
}

function assertSchemaInstructions(schema: SpecificationSchemaInstructions): void {
  assertDigest(schema.digest, 'Specification schema instructions');
  const { digest, ...stable } = schema;
  if (sha256(stable) !== digest) {
    throw new Error('Specification schema instructions digest is invalid');
  }
  if (!schema.schemaName.trim()) throw new Error('Specification schema name is required');
  if (
    schema.artifacts.length !== REQUIRED_PLANNING_ARTIFACTS.length ||
    new Set(schema.artifacts.map((artifact) => artifact.kind)).size !==
      REQUIRED_PLANNING_ARTIFACTS.length
  ) {
    throw new Error('Specification schema must contain four official artifact instructions');
  }
  for (const artifact of schema.artifacts) {
    assertDigest(artifact.instructionDigest, `Specification ${artifact.kind} instructions`);
    assertDigest(artifact.templateDigest, `Specification ${artifact.kind} template`);
  }
}

export function createPlanningSnapshot(input: {
  change: SpecificationChange;
  validation: SpecificationValidation;
  schema: SpecificationSchemaInstructions;
  specificationRoot: PlanningSpecificationRoot;
  changeBranch: ChangeBranchReference;
  approvalPhase?: 'open' | 'design';
  planningManifest?: SpecificationPlanningManifest;
  planningPolicyDigest?: `sha256:${string}`;
  buildStrategyDigest?: `sha256:${string}`;
}): PlanningSnapshot {
  const manifest =
    input.planningManifest ??
    createSpecificationPlanningManifest({
      change: input.change,
      specificationRoot: input.specificationRoot,
      schema: input.schema,
    });
  assertSpecificationPlanningManifest(manifest);
  const expectedManifest = createSpecificationPlanningManifest({
    change: input.change,
    specificationRoot: input.specificationRoot,
    schema: input.schema,
  });
  if (manifest.semanticDigest !== expectedManifest.semanticDigest) {
    throw new Error('Planning manifest does not match the Design gate inputs');
  }
  if (!input.change.planningComplete) {
    throw new Error('Specification planning is incomplete');
  }
  if (
    input.validation.changeId !== input.change.changeId ||
    canonicalJson(input.validation.provider) !== canonicalJson(input.change.provider)
  ) {
    throw new Error('Specification validation does not match the inspected change');
  }
  if (canonicalJson(input.schema.provider) !== canonicalJson(input.change.provider)) {
    throw new Error('Specification schema instructions do not match the inspected change');
  }
  if (!input.validation.strict || !input.validation.valid) {
    throw new Error('Specification planning requires successful strict validation');
  }
  assertDigest(input.change.changeDigest, 'Specification change');
  assertDigest(input.validation.validationDigest, 'Specification validation');
  assertSchemaInstructions(input.schema);
  if (!input.specificationRoot.storeId.trim() || !input.specificationRoot.repositoryId.trim()) {
    throw new Error('Specification Root identity is required');
  }
  const changeBranch = normalizeBranch(input.changeBranch);
  const artifacts = normalizePlanningArtifacts(input.change);
  const affectedCapabilities = [...new Set(input.change.affectedCapabilities)].sort();
  const planningPolicyDigest =
    input.planningPolicyDigest ?? sha256({ kind: 'PlanningPolicy', schemaVersion: 1 });
  assertDigest(planningPolicyDigest, 'Planning policy');
  const approvalPhase = input.approvalPhase ?? 'design';
  const buildStrategyDigest =
    approvalPhase === 'design' ? (input.buildStrategyDigest ?? null) : null;
  if (approvalPhase === 'design' && !buildStrategyDigest) {
    throw new Error('Design planning requires an approved Build Strategy proposal');
  }
  if (buildStrategyDigest) assertDigest(buildStrategyDigest, 'Build Strategy');
  const planningSemantic = createRuntimeIdentity('planning-semantic', {
    changeId: input.change.changeId,
    approvalPhase,
    provider: input.change.provider,
    schemaDigest: input.schema.digest,
    specificationRoot: input.specificationRoot,
    changeDigest: input.change.changeDigest,
    artifacts,
    affectedCapabilities,
    targetBranch: changeBranch.targetBranch,
    planningManifestDigest: manifest.semanticDigest,
    planningPolicyDigest,
    buildStrategyDigest,
  });
  const validationObservation = createRuntimeIdentity('validation-observation', {
    planningSemantic: planningSemantic.digest,
    validationDigest: input.validation.validationDigest,
    strict: input.validation.strict,
    valid: input.validation.valid,
  });
  const approvalAuthority = createRuntimeIdentity('approval-authority', {
    planningSemantic: planningSemantic.digest,
    approvalPhase,
  });
  const publicationProvenance = createRuntimeIdentity('publication-provenance', {
    changeBranch,
  });
  const stable: Omit<PlanningSnapshot, 'digest'> = {
    schemaVersion: 3 as const,
    changeId: input.change.changeId,
    approvalPhase,
    provider: structuredClone(input.change.provider),
    schema: structuredClone(input.schema),
    specificationRoot: structuredClone(input.specificationRoot),
    changeDigest: input.change.changeDigest,
    validationDigest: input.validation.validationDigest,
    artifacts,
    affectedCapabilities,
    changeBranch,
    publicationProvenanceDigest: publicationProvenance.digest,
    planningManifestDigest: manifest.semanticDigest,
    planningPolicyDigest,
    buildStrategyDigest,
    identityBasis: {
      schemaVersion: 1,
      planningSemantic,
      validationObservation,
      approvalAuthority,
      publicationProvenance,
    },
  };
  return { ...stable, digest: planningSnapshotDigest(stable) };
}

export function assertPlanningSnapshot(snapshot: PlanningSnapshot): void {
  const { digest, ...stable } = snapshot;
  assertDigest(digest, 'Planning snapshot');
  if (!snapshot.identityBasis?.planningSemantic) {
    throw new Error('Planning snapshot requires a typed identity basis');
  }
  if (snapshot.approvalPhase !== 'open' && snapshot.approvalPhase !== 'design') {
    throw new Error('Planning snapshot approval phase is invalid');
  }
  if (snapshot.schemaVersion !== 3) {
    throw new Error('Legacy planning snapshot requires migration');
  }
  if (planningSnapshotDigest(stable) !== digest) {
    throw new Error('Planning snapshot digest is invalid');
  }
  assertSchemaInstructions(snapshot.schema);
  const branch = normalizeBranch(snapshot.changeBranch);
  assertDigest(snapshot.publicationProvenanceDigest, 'Publication provenance');
  if (
    createRuntimeIdentity('publication-provenance', { changeBranch: branch }).digest !==
    snapshot.publicationProvenanceDigest
  ) {
    throw new Error('Planning snapshot publication provenance digest is invalid');
  }
  if (snapshot.identityBasis.planningSemantic.digest !== digest) {
    throw new Error('Planning snapshot semantic identity is invalid');
  }
  const expectedValidation = createRuntimeIdentity('validation-observation', {
    planningSemantic: digest,
    validationDigest: snapshot.validationDigest,
    strict: true,
    valid: true,
  });
  if (snapshot.identityBasis.validationObservation?.digest !== expectedValidation.digest) {
    throw new Error('Planning snapshot validation observation identity is invalid');
  }
  const expectedApproval = createRuntimeIdentity('approval-authority', {
    planningSemantic: digest,
    approvalPhase: snapshot.approvalPhase,
  });
  if (snapshot.identityBasis.approvalAuthority?.digest !== expectedApproval.digest) {
    throw new Error('Planning snapshot approval authority identity is invalid');
  }
  if (
    snapshot.identityBasis.publicationProvenance?.digest !== snapshot.publicationProvenanceDigest
  ) {
    throw new Error('Planning snapshot publication provenance identity is invalid');
  }
  if (
    snapshot.artifacts.length !== REQUIRED_PLANNING_ARTIFACTS.length ||
    new Set(snapshot.artifacts.map((artifact) => artifact.kind)).size !==
      REQUIRED_PLANNING_ARTIFACTS.length
  ) {
    throw new Error('Planning snapshot does not contain the four planning artifacts');
  }
  for (const artifact of snapshot.artifacts) {
    assertDigest(artifact.digest, `Planning snapshot artifact ${artifact.kind}`);
  }
}

export function createSpecificationApprovalRequest(
  snapshot: PlanningSnapshot,
  requestId: string = `specification-approval:${snapshot.approvalPhase}:${snapshot.identityBasis.approvalAuthority?.digest.slice(-24) ?? 'missing-authority'}`,
): SpecificationApprovalDecisionRequest {
  assertPlanningSnapshot(snapshot);
  if (!requestId.trim()) throw new Error('Specification approval request ID is required');
  const proposal = createSpecificationApprovalProposal(snapshot);
  const proposalHash = hashApprovalProposal(proposal);
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    decisionType: 'specification-approval',
    requestId,
    changeId: snapshot.changeId,
    approvalPhase: snapshot.approvalPhase,
    snapshotDigest: snapshot.digest,
    proposal,
    proposalHash,
    provider: structuredClone(snapshot.provider),
    schema: structuredClone(snapshot.schema),
    artifacts: structuredClone(snapshot.artifacts),
    affectedCapabilities: [...snapshot.affectedCapabilities],
    changeBranch: structuredClone(snapshot.changeBranch),
    options: ['approve', 'revise', 'reject'],
  };
}

export function createSpecificationApprovalProposal(
  snapshot: PlanningSnapshot,
): SpecificationApprovalProposal {
  assertPlanningSnapshot(snapshot);
  return {
    schemaVersion: 1,
    kind: 'SpecificationApprovalProposal',
    changeId: snapshot.changeId,
    approvalPhase: snapshot.approvalPhase,
    specificationRoot: structuredClone(snapshot.specificationRoot),
    provider: structuredClone(snapshot.provider),
    schema: { name: snapshot.schema.schemaName, digest: snapshot.schema.digest },
    semanticDigest: snapshot.digest,
    affectedCapabilities: [...snapshot.affectedCapabilities].sort(),
    targetBranch: snapshot.changeBranch.targetBranch,
    buildStrategyDigest: snapshot.buildStrategyDigest,
  };
}

export function hashApprovalProposal(proposal: SpecificationApprovalProposal): `sha256:${string}` {
  return sha256(proposal);
}

function approvalHash(record: Omit<SpecificationApprovalRecord, 'approvalHash'>) {
  return sha256({ kind: 'SpecificationApproval', ...record });
}

export function specificationApprovalCompatibility(state: SpecificationApprovalState): {
  status: 'current' | 'migration_required';
  reason: string;
} {
  try {
    assertSpecificationApprovalState(state);
    return { status: 'current', reason: 'Planning approval uses the current semantic schema' };
  } catch (error) {
    return {
      status: 'migration_required',
      reason:
        error instanceof Error ? error.message : 'Legacy planning approval requires migration',
    };
  }
}

export function createSpecificationApprovalMigrationPlan(
  state: SpecificationApprovalState,
): SpecificationApprovalMigrationPlan {
  const compatibility = specificationApprovalCompatibility(state);
  const stable = {
    schemaVersion: 1 as const,
    kind: 'SpecificationApprovalMigrationPlan' as const,
    changeId: state.changeId,
    status: compatibility.status,
    persistedSnapshotDigest: state.snapshot.digest,
    reason: compatibility.reason,
    requiredActions:
      compatibility.status === 'migration_required'
        ? [
            'recompute-current-planning-manifest',
            'verify-current-publication-provenance',
            'request-new-trusted-human-decision',
          ]
        : [],
    externalSideEffects: [] as const,
  };
  return { ...stable, planDigest: sha256(stable) };
}

export function assertSpecificationApprovalState(state: SpecificationApprovalState): void {
  assertPlanningSnapshot(state.snapshot);
  const request = state.decisionRequest as SpecificationApprovalDecisionRequest & {
    proposal?: SpecificationApprovalProposal;
    proposalHash?: `sha256:${string}`;
  };
  if (!request.proposal || !request.proposalHash) {
    throw new Error('Legacy specification approval requires migration');
  }
  const expectedProposal = createSpecificationApprovalProposal(state.snapshot);
  if (
    canonicalJson(request.proposal) !== canonicalJson(expectedProposal) ||
    request.proposalHash !== hashApprovalProposal(expectedProposal) ||
    request.snapshotDigest !== state.snapshot.digest ||
    request.changeId !== state.changeId ||
    request.approvalPhase !== state.approvalPhase ||
    canonicalJson(request.changeBranch) !== canonicalJson(state.snapshot.changeBranch)
  ) {
    throw new Error('Specification approval proposal hash is invalid');
  }
  if (state.decision) {
    const { approvalHash: actualApprovalHash, ...record } = state.decision;
    if (
      record.requestId !== request.requestId ||
      record.changeId !== state.changeId ||
      record.approvalPhase !== state.approvalPhase ||
      record.snapshotDigest !== state.snapshot.digest ||
      record.proposalHash !== request.proposalHash ||
      (record.decision === 'approve'
        ? actualApprovalHash !== approvalHash(record)
        : actualApprovalHash !== null)
    ) {
      throw new Error('Specification approval hash is invalid');
    }
  }
  const expectedStatus = state.decision
    ? state.decision.decision === 'approve'
      ? 'approved'
      : state.decision.decision === 'revise'
        ? 'changes_requested'
        : 'rejected'
    : 'awaiting_approval';
  if (state.status !== expectedStatus) {
    throw new Error('Specification approval status does not match its Human Decision');
  }
}

export function requestSpecificationApproval(input: {
  current: SpecificationApprovalState | null;
  snapshot: PlanningSnapshot;
  timestamp: string;
  requestId?: string;
  forceNewRequest?: boolean;
}): SpecificationApprovalState {
  assertPlanningSnapshot(input.snapshot);
  const current = input.current;
  if (
    current &&
    (current.changeId !== input.snapshot.changeId ||
      current.approvalPhase !== input.snapshot.approvalPhase)
  ) {
    throw new Error('Specification approval state belongs to another change');
  }
  const currentCompatibility = current ? specificationApprovalCompatibility(current) : null;
  if (currentCompatibility?.status === 'migration_required') {
    throw new Error(currentCompatibility.reason);
  }
  if (
    input.forceNewRequest === true &&
    currentCompatibility?.status === 'current' &&
    current?.snapshot.digest === input.snapshot.digest &&
    current.status === 'awaiting_approval' &&
    current.decision === null &&
    input.requestId &&
    current.decisionRequest.requestId === input.requestId
  ) {
    return structuredClone(current);
  }
  if (
    input.forceNewRequest !== true &&
    currentCompatibility?.status === 'current' &&
    current?.snapshot.digest === input.snapshot.digest
  ) {
    if (
      current.snapshot.publicationProvenanceDigest === input.snapshot.publicationProvenanceDigest
    ) {
      return structuredClone(current);
    }
    return {
      ...structuredClone(current),
      stateVersion: current.stateVersion + 1,
      snapshot: structuredClone(input.snapshot),
      decisionRequest: {
        ...structuredClone(current.decisionRequest),
        changeBranch: structuredClone(input.snapshot.changeBranch),
      },
      updatedAt: input.timestamp,
    };
  }
  const decisionRequest = createSpecificationApprovalRequest(input.snapshot, input.requestId);
  if (
    current?.decisionRequest.requestId === decisionRequest.requestId &&
    current.decisionRequest.proposalHash !== decisionRequest.proposalHash
  ) {
    throw new Error('Specification approval idempotency key conflicts with another proposal');
  }
  return {
    schemaVersion: 1,
    changeId: input.snapshot.changeId,
    approvalPhase: input.snapshot.approvalPhase,
    stateVersion: (current?.stateVersion ?? -1) + 1,
    status: 'awaiting_approval',
    snapshot: structuredClone(input.snapshot),
    decisionRequest,
    decision: null,
    updatedAt: input.timestamp,
  };
}

export function recordSpecificationApprovalDecision(input: {
  state: SpecificationApprovalState;
  response: SpecificationApprovalDecisionResponse;
  actor: SpecificationApprovalActor;
  timestamp: string;
}): SpecificationApprovalState {
  if (!input.actor.authenticated || !input.actor.actorId.trim()) {
    throw new Error('Specification approval decision is not trusted');
  }
  assertSpecificationApprovalState(input.state);
  const request = input.state.decisionRequest;
  const response = input.response;
  if (input.state.decision) {
    if (
      input.state.decision.requestId === response.requestId &&
      input.state.decision.proposalHash === response.proposalHash &&
      input.state.decision.decision === response.decision &&
      input.state.decision.actorId === input.actor.actorId &&
      input.state.decision.source === input.actor.source
    ) {
      return structuredClone(input.state);
    }
    throw new Error('Specification approval already has a different Human Decision');
  }
  if (input.state.status !== 'awaiting_approval') {
    throw new Error(`Specification approval is not awaiting a decision: ${input.state.status}`);
  }
  if (
    response.apiVersion !== 'repoctopus/v1alpha1' ||
    response.kind !== 'HumanDecisionResponse' ||
    response.requestId !== request.requestId ||
    response.proposalHash !== request.proposalHash ||
    !request.options.includes(response.decision)
  ) {
    throw new Error('Specification approval response does not match the pending request');
  }
  const decisionBase: Omit<SpecificationApprovalRecord, 'approvalHash'> = {
    schemaVersion: 1,
    requestId: request.requestId,
    changeId: input.state.changeId,
    approvalPhase: input.state.approvalPhase,
    snapshotDigest: input.state.snapshot.digest,
    proposalHash: request.proposalHash,
    decision: response.decision,
    actorId: input.actor.actorId,
    source: input.actor.source,
    decidedAt: input.timestamp,
    ...(response.comment ? { comment: response.comment } : {}),
  };
  const decision: SpecificationApprovalRecord = {
    ...decisionBase,
    approvalHash: response.decision === 'approve' ? approvalHash(decisionBase) : null,
  };
  return {
    ...input.state,
    stateVersion: input.state.stateVersion + 1,
    status:
      response.decision === 'approve'
        ? 'approved'
        : response.decision === 'revise'
          ? 'changes_requested'
          : 'rejected',
    decision,
    updatedAt: input.timestamp,
  };
}

export interface SpecificationApprovalStorePort {
  load(
    changeId: string,
    approvalPhase?: 'open' | 'design',
  ): Promise<SpecificationApprovalState | null>;
  commit(state: SpecificationApprovalState, previousStateVersion: number | null): Promise<void>;
}
