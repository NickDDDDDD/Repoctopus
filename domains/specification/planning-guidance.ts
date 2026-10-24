import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  SpecificationArtifactKind,
  SpecificationMethodRule,
  SpecificationPlanningGuidance,
  SpecificationSchemaInstructions,
} from './types.js';

type PlanningArtifactKind = Exclude<SpecificationArtifactKind, 'verification'>;

const RULES = {
  'planning.synthesize-known-context': {
    id: 'planning.synthesize-known-context',
    sources: ['to-spec'],
    statement:
      'Synthesize decisions already established by conversation and repository evidence; do not repeat an interview for resolved decisions.',
  },
  'design.public-test-seams': {
    id: 'design.public-test-seams',
    sources: ['to-spec', 'tdd', 'codebase-design'],
    statement:
      'Record the fewest stable public seams needed to observe required behavior; request a decision only when the seam remains materially unresolved.',
  },
  'planning.decision-rich-not-volatile': {
    id: 'planning.decision-rich-not-volatile',
    sources: ['to-spec'],
    statement:
      'Record durable implementation decisions without volatile paths or full code; retain only fragments that encode a decision more precisely than prose.',
  },
  'tasks.tracer-bullet-slices': {
    id: 'tasks.tracer-bullet-slices',
    sources: ['to-tickets'],
    statement:
      'Use narrow, complete, independently verifiable tracer-bullet slices sized for one fresh execution context.',
  },
  'tasks.explicit-blocking-edges': {
    id: 'tasks.explicit-blocking-edges',
    sources: ['to-tickets'],
    statement: 'Represent only genuine task blockers and order work from satisfied dependencies.',
  },
  'tasks.expand-contract-wide-refactors': {
    id: 'tasks.expand-contract-wide-refactors',
    sources: ['to-tickets'],
    statement:
      'Order wide migrations as expand, bounded migration batches, verification, then contract so intermediate states remain valid.',
  },
  'tasks.verifiable-acceptance': {
    id: 'tasks.verifiable-acceptance',
    sources: ['to-tickets'],
    statement:
      'Give every task observable acceptance criteria and an explicit verification step that can produce evidence.',
  },
} as const satisfies Record<string, SpecificationMethodRule>;

const RULE_IDS_BY_ARTIFACT = {
  proposal: ['planning.synthesize-known-context'],
  'delta-specs': ['planning.synthesize-known-context'],
  design: [
    'planning.synthesize-known-context',
    'design.public-test-seams',
    'planning.decision-rich-not-volatile',
  ],
  tasks: [
    'planning.synthesize-known-context',
    'planning.decision-rich-not-volatile',
    'tasks.tracer-bullet-slices',
    'tasks.explicit-blocking-edges',
    'tasks.expand-contract-wide-refactors',
    'tasks.verifiable-acceptance',
  ],
} as const satisfies Record<PlanningArtifactKind, readonly (keyof typeof RULES)[]>;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createSpecificationPlanningGuidance(
  schema: SpecificationSchemaInstructions,
): SpecificationPlanningGuidance {
  const artifacts = schema.artifacts.map((artifact) => ({
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    rules: RULE_IDS_BY_ARTIFACT[artifact.kind].map((ruleId) => structuredClone(RULES[ruleId])),
  }));
  const artifactKinds = artifacts.map((artifact) => artifact.artifactKind);
  if (
    artifacts.length !== 4 ||
    new Set(artifactKinds).size !== 4 ||
    Object.keys(RULE_IDS_BY_ARTIFACT).some(
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
