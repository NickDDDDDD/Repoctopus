import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  ChangeBranchReference,
  PlanningArtifactSnapshot,
  PlanningSnapshot,
  SpecificationApprovalDecisionRequest,
  SpecificationChange,
  SpecificationValidation,
} from './types.js';

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

export function createPlanningSnapshot(input: {
  change: SpecificationChange;
  validation: SpecificationValidation;
  changeBranch: ChangeBranchReference;
  compositionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
}): PlanningSnapshot {
  if (!input.change.planningComplete) {
    throw new Error('Specification planning is incomplete');
  }
  if (
    input.validation.changeId !== input.change.changeId ||
    canonicalJson(input.validation.provider) !== canonicalJson(input.change.provider)
  ) {
    throw new Error('Specification validation does not match the inspected change');
  }
  if (!input.validation.strict || !input.validation.valid) {
    throw new Error('Specification planning requires successful strict validation');
  }
  assertDigest(input.change.changeDigest, 'Specification change');
  assertDigest(input.validation.validationDigest, 'Specification validation');
  assertDigest(input.compositionDigest, 'Composition');
  assertDigest(input.projectConfigDigest, 'Project configuration');
  const stable = {
    schemaVersion: 1 as const,
    changeId: input.change.changeId,
    provider: structuredClone(input.change.provider),
    changeDigest: input.change.changeDigest,
    validationDigest: input.validation.validationDigest,
    artifacts: normalizePlanningArtifacts(input.change),
    affectedCapabilities: [...new Set(input.change.affectedCapabilities)].sort(),
    changeBranch: normalizeBranch(input.changeBranch),
    compositionDigest: input.compositionDigest,
    projectConfigDigest: input.projectConfigDigest,
  };
  return { ...stable, digest: sha256(stable) };
}

export function assertPlanningSnapshot(snapshot: PlanningSnapshot): void {
  const { digest, ...stable } = snapshot;
  assertDigest(digest, 'Planning snapshot');
  if (sha256(stable) !== digest) throw new Error('Planning snapshot digest is invalid');
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
  if (!requestId.trim()) throw new Error('Specification approval request ID is required');
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    decisionType: 'specification-approval',
    requestId,
    changeId: snapshot.changeId,
    snapshotDigest: snapshot.digest,
    provider: structuredClone(snapshot.provider),
    artifacts: structuredClone(snapshot.artifacts),
    affectedCapabilities: [...snapshot.affectedCapabilities],
    changeBranch: structuredClone(snapshot.changeBranch),
    options: ['approve', 'request_changes', 'reject'],
  };
}
