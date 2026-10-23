import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  ChangeBranchReference,
  PlanningArtifactSnapshot,
  PlanningSpecificationRoot,
  PlanningSnapshot,
  SpecificationApprovalProposal,
  SpecificationApprovalActor,
  SpecificationApprovalDecisionRequest,
  SpecificationApprovalDecisionResponse,
  SpecificationApprovalRecord,
  SpecificationApprovalState,
  SpecificationChange,
  SpecificationSchemaInstructions,
  SpecificationValidation,
  SpecificationPlanningManifest,
} from './types.js';
import {
  assertSpecificationPlanningManifest,
  createSpecificationPlanningManifest,
} from './planning-manifest.js';

const REQUIRED_PLANNING_ARTIFACTS = ['proposal', 'design', 'delta-specs', 'tasks'] as const;
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

function normalizePlanningArtifacts(change: SpecificationChange): PlanningArtifactSnapshot[] {
  const planning = change.artifacts.filter((artifact) => artifact.kind !== 'verification');
  const byKind = new Map(planning.map((artifact) => [artifact.kind, artifact]));
  if (
    planning.length !== REQUIRED_PLANNING_ARTIFACTS.length ||
    byKind.size !== REQUIRED_PLANNING_ARTIFACTS.length
  ) {
    throw new Error('Specification planning requires exactly four planning artifacts');
  }
  return REQUIRED_PLANNING_ARTIFACTS.map((kind) => {
    const artifact = byKind.get(kind);
    if (!artifact || artifact.status !== 'ready' || !artifact.digest) {
      throw new Error(`Specification planning artifact is not ready: ${kind}`);
    }
    assertDigest(artifact.digest, `Specification planning artifact ${kind}`);
    return { id: artifact.id, kind, digest: artifact.digest };
  }).sort((left, right) => left.id.localeCompare(right.id));
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
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  planningManifest?: SpecificationPlanningManifest;
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
  assertDigest(input.compositionDigest, 'Composition');
  assertDigest(input.projectConfigDigest, 'Project configuration');
  assertSchemaInstructions(input.schema);
  if (!input.specificationRoot.storeId.trim() || !input.specificationRoot.repositoryId.trim()) {
    throw new Error('Specification Root identity is required');
  }
  const stable = {
    schemaVersion: 1 as const,
    changeId: input.change.changeId,
    provider: structuredClone(input.change.provider),
    schema: structuredClone(input.schema),
    specificationRoot: structuredClone(input.specificationRoot),
    changeDigest: input.change.changeDigest,
    validationDigest: input.validation.validationDigest,
    artifacts: normalizePlanningArtifacts(input.change),
    affectedCapabilities: [...new Set(input.change.affectedCapabilities)].sort(),
    changeBranch: normalizeBranch(input.changeBranch),
    compositionDigest: input.compositionDigest,
    projectConfigDigest: input.projectConfigDigest,
    planningManifestDigest: manifest.semanticDigest,
  };
  return { ...stable, digest: sha256(stable) };
}

export function assertPlanningSnapshot(snapshot: PlanningSnapshot): void {
  const { digest, ...stable } = snapshot;
  assertDigest(digest, 'Planning snapshot');
  if (sha256(stable) !== digest) throw new Error('Planning snapshot digest is invalid');
  if (snapshot.schema) assertSchemaInstructions(snapshot.schema);
  normalizeBranch(snapshot.changeBranch);
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
  requestId: string = randomUUID(),
): SpecificationApprovalDecisionRequest {
  assertPlanningSnapshot(snapshot);
  if (!snapshot.schema) {
    throw new Error('Legacy planning snapshot requires schema instructions migration');
  }
  if (!snapshot.specificationRoot) {
    throw new Error('Legacy planning snapshot requires Specification Root migration');
  }
  if (!requestId.trim()) throw new Error('Specification approval request ID is required');
  const proposal = createSpecificationApprovalProposal(snapshot);
  const proposalHash = hashApprovalProposal(proposal);
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    decisionType: 'specification-approval',
    requestId,
    changeId: snapshot.changeId,
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
  if (!snapshot.schema || !snapshot.specificationRoot) {
    throw new Error('Current approval proposal requires schema and Specification Root identity');
  }
  return {
    schemaVersion: 1,
    kind: 'SpecificationApprovalProposal',
    changeId: snapshot.changeId,
    specificationRoot: structuredClone(snapshot.specificationRoot),
    provider: structuredClone(snapshot.provider),
    schema: { name: snapshot.schema.schemaName, digest: snapshot.schema.digest },
    semanticDigest: snapshot.digest,
    affectedCapabilities: [...snapshot.affectedCapabilities].sort(),
    targetBranch: snapshot.changeBranch.targetBranch,
  };
}

export function hashApprovalProposal(
  proposal: SpecificationApprovalProposal,
): `sha256:${string}` {
  return sha256(proposal);
}

function approvalHash(record: Omit<SpecificationApprovalRecord, 'approvalHash'>) {
  return sha256({ kind: 'SpecificationApproval', ...record });
}

export function assertSpecificationApprovalState(
  state: SpecificationApprovalState,
  options: { allowLegacy?: boolean } = {},
): void {
  assertPlanningSnapshot(state.snapshot);
  const request = state.decisionRequest as SpecificationApprovalDecisionRequest & {
    proposal?: SpecificationApprovalProposal;
    proposalHash?: `sha256:${string}`;
  };
  if (
    !request.proposal ||
    !request.proposalHash ||
    !state.snapshot.schema ||
    !state.snapshot.specificationRoot
  ) {
    if (options.allowLegacy === true) return;
    throw new Error('Legacy specification approval requires migration');
  }
  const expectedProposal = createSpecificationApprovalProposal(state.snapshot);
  if (
    canonicalJson(request.proposal) !== canonicalJson(expectedProposal) ||
    request.proposalHash !== hashApprovalProposal(expectedProposal) ||
    request.snapshotDigest !== state.snapshot.digest ||
    request.changeId !== state.changeId
  ) {
    throw new Error('Specification approval proposal hash is invalid');
  }
  if (state.decision) {
    const { approvalHash: actualApprovalHash, ...record } = state.decision;
    if (
      record.requestId !== request.requestId ||
      record.changeId !== state.changeId ||
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
}): SpecificationApprovalState {
  assertPlanningSnapshot(input.snapshot);
  const current = input.current;
  if (current && current.changeId !== input.snapshot.changeId) {
    throw new Error('Specification approval state belongs to another change');
  }
  if (current?.snapshot.digest === input.snapshot.digest) return structuredClone(current);
  return {
    schemaVersion: 1,
    changeId: input.snapshot.changeId,
    stateVersion: (current?.stateVersion ?? -1) + 1,
    status: 'awaiting_approval',
    snapshot: structuredClone(input.snapshot),
    decisionRequest: createSpecificationApprovalRequest(input.snapshot, input.requestId),
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
  load(changeId: string): Promise<SpecificationApprovalState | null>;
  commit(state: SpecificationApprovalState, previousStateVersion: number | null): Promise<void>;
}
