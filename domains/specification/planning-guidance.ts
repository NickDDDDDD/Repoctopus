import { createHash } from 'node:crypto';

import { BUILTIN_METHOD_PROFILE_REGISTRY } from '../change-lifecycle/method-profile.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  SpecificationArtifactKind,
  SpecificationPlanningGuidance,
  SpecificationSchemaInstructions,
} from './types.js';

type PlanningArtifactKind = Exclude<SpecificationArtifactKind, 'verification'>;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createSpecificationPlanningGuidance(
  schema: SpecificationSchemaInstructions,
): SpecificationPlanningGuidance {
  const profile = BUILTIN_METHOD_PROFILE_REGISTRY.snapshot('repoctopus.design', '1.0.0');
  const context = BUILTIN_METHOD_PROFILE_REGISTRY.assemble({
    profile,
    phase: 'design',
    artifactKinds: schema.artifacts.map((artifact) => artifact.kind),
  });
  const artifacts = schema.artifacts.map((artifact) => ({
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    rules: context.rules
      .filter((rule) => rule.artifactKinds.includes(artifact.kind))
      .map((rule) => structuredClone(rule)),
  }));
  const artifactKinds = artifacts.map((artifact) => artifact.artifactKind);
  if (
    artifacts.length !== 4 ||
    new Set(artifactKinds).size !== 4 ||
    ['proposal', 'delta-specs', 'design', 'tasks'].some(
      (kind) => !artifactKinds.includes(kind as PlanningArtifactKind),
    )
  ) {
    throw new Error('Planning guidance requires exactly four official planning artifacts');
  }
  const stable = {
    schemaVersion: 1 as const,
    kind: 'SpecificationPlanningGuidance' as const,
    provider: structuredClone(schema.provider),
    schemaName: schema.schemaName,
    schemaDigest: schema.digest,
    artifacts,
    outputContract: {
      artifactKinds,
      allowAdditionalPlanningArtifacts: false as const,
      trackerPublish: false as const,
    },
  };
  return { ...stable, digest: sha256(stable) };
}
