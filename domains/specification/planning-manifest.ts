import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  PlanningSpecificationRoot,
  SpecificationChange,
  SpecificationPlanningManifest,
  SpecificationSchemaInstructions,
} from './types.js';

const PLANNING_KINDS = ['proposal', 'design', 'delta-specs', 'tasks'] as const;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createSpecificationPlanningManifest(input: {
  change: SpecificationChange;
  specificationRoot: PlanningSpecificationRoot;
  schema: SpecificationSchemaInstructions;
}): SpecificationPlanningManifest {
  if (canonicalJson(input.change.provider) !== canonicalJson(input.schema.provider)) {
    throw new Error('Planning manifest Provider and schema identities do not match');
  }
  const artifacts = input.change.artifacts.filter((artifact) => artifact.kind !== 'verification');
  if (
    artifacts.length !== PLANNING_KINDS.length ||
    new Set(artifacts.map((artifact) => artifact.kind)).size !== PLANNING_KINDS.length ||
    PLANNING_KINDS.some((kind) => !artifacts.some((artifact) => artifact.kind === kind))
  ) {
    throw new Error('Planning manifest requires exactly four official planning artifacts');
  }
  const change = structuredClone(input.change);
  change.artifacts = [...artifacts].sort((left, right) => left.kind.localeCompare(right.kind));
  change.affectedCapabilities = [...new Set(change.affectedCapabilities)].sort();
  change.retiredCapabilities = [...new Set(change.retiredCapabilities)].sort();
  const stable = {
    schemaVersion: 1 as const,
    kind: 'SpecificationPlanningManifest' as const,
    change,
    specificationRoot: structuredClone(input.specificationRoot),
    schema: structuredClone(input.schema),
  };
  return { ...stable, semanticDigest: sha256(stable) };
}

export function assertSpecificationPlanningManifest(manifest: SpecificationPlanningManifest): void {
  const expected = createSpecificationPlanningManifest(manifest);
  if (
    manifest.semanticDigest !== expected.semanticDigest ||
    canonicalJson(manifest) !== canonicalJson(expected)
  ) {
    throw new Error('Specification planning manifest semantic digest is invalid');
  }
}
