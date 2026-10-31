import type {
  PlanningArtifactSnapshot,
  SpecificationArtifact,
  SpecificationChange,
  SpecificationValidation,
} from './types.js';

export const REQUIRED_PLANNING_ARTIFACTS = ['proposal', 'design', 'delta-specs', 'tasks'] as const;

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function isSpecificationArtifactSatisfied(artifact: SpecificationArtifact): boolean {
  return (
    (artifact.status === 'ready' || artifact.status === 'skipped') &&
    typeof artifact.digest === 'string' &&
    SHA256_DIGEST.test(artifact.digest)
  );
}

export function normalizePlanningArtifacts(
  change: SpecificationChange,
): PlanningArtifactSnapshot[] {
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
    if (!artifact || !isSpecificationArtifactSatisfied(artifact)) {
      throw new Error(`Specification planning artifact is not satisfied: ${kind}`);
    }
    return { id: artifact.id, kind, digest: artifact.digest! };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function assertSpecificationValidationConsistency(
  validation: SpecificationValidation,
): void {
  if (validation.valid && validation.diagnostics.some(({ severity }) => severity === 'error')) {
    throw new Error('Valid Specification validation contains an error diagnostic');
  }
}
