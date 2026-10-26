import { createHash } from 'node:crypto';

import type { SpecificationArtifactKind } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { ChangePhase, MethodProfileSnapshot } from './transition.js';

export type MethodRuleEnforcement =
  | 'context'
  | 'deterministic-validator'
  | 'review-rubric'
  | 'human-decision';

export interface MethodRuleDefinition {
  id: string;
  sources: readonly string[];
  sourceDigests: readonly `sha256:${string}`[];
  phases: readonly ChangePhase[];
  artifactKinds: readonly Exclude<SpecificationArtifactKind, 'verification'>[];
  enforcement: MethodRuleEnforcement;
  statement: string;
}

export interface MethodProfileDefinition {
  schemaVersion: 1;
  id: string;
  version: string;
  ruleIds: readonly string[];
}

const SOURCE_DIGESTS = {
  'to-spec': 'sha256:c73a2250beac0479e384f5466e834bb54ce6e30b7f8705e9999ba840d9d59b36',
  'to-tickets': 'sha256:b8eb6dca1085e85220b0f5990ed787ebf8a924844d090689f1073b06367e2f7a',
  tdd: 'sha256:969583080caf842ae86a53501a0091eced13fd89cad65d3aa75c09112318ff33',
  'codebase-design': 'sha256:362b0bec828219d9f4b08ca7c466164e67253bdd817359258e60d2e9c5692a8f',
} as const;

const RULES: readonly MethodRuleDefinition[] = [
  {
    id: 'planning.synthesize-known-context',
    sources: ['to-spec'],
    sourceDigests: [SOURCE_DIGESTS['to-spec']],
    phases: ['design'],
    artifactKinds: ['proposal', 'delta-specs', 'design', 'tasks'],
    enforcement: 'context',
    statement:
      'Synthesize decisions already established by conversation and repository evidence; do not repeat an interview for resolved decisions.',
  },
  {
    id: 'planning.decision-rich-not-volatile',
    sources: ['to-spec'],
    sourceDigests: [SOURCE_DIGESTS['to-spec']],
    phases: ['design'],
    artifactKinds: ['design', 'tasks'],
    enforcement: 'review-rubric',
    statement:
      'Record durable implementation decisions without volatile paths or full code; retain only fragments that encode a decision more precisely than prose.',
  },
  {
    id: 'tasks.tracer-bullet-slices',
    sources: ['to-tickets'],
    sourceDigests: [SOURCE_DIGESTS['to-tickets']],
    phases: ['design', 'build'],
    artifactKinds: ['tasks'],
    enforcement: 'review-rubric',
    statement:
      'Use narrow, complete, independently verifiable tracer-bullet slices sized for one fresh execution context.',
  },
  {
    id: 'tasks.explicit-blocking-edges',
    sources: ['to-tickets'],
    sourceDigests: [SOURCE_DIGESTS['to-tickets']],
    phases: ['design', 'build'],
    artifactKinds: ['tasks'],
    enforcement: 'deterministic-validator',
    statement: 'Represent only genuine task blockers and order work from satisfied dependencies.',
  },
  {
    id: 'tasks.expand-contract-wide-refactors',
    sources: ['to-tickets'],
    sourceDigests: [SOURCE_DIGESTS['to-tickets']],
    phases: ['design', 'build'],
    artifactKinds: ['tasks'],
    enforcement: 'review-rubric',
    statement:
      'Order wide migrations as expand, bounded migration batches, verification, then contract so intermediate states remain valid.',
  },
  {
    id: 'tasks.verifiable-acceptance',
    sources: ['to-tickets'],
    sourceDigests: [SOURCE_DIGESTS['to-tickets']],
    phases: ['design', 'verify'],
    artifactKinds: ['tasks'],
    enforcement: 'deterministic-validator',
    statement:
      'Give every tracked task at least one indented **Acceptance:** criterion and an evidence-producing verification step.',
  },
];

const PROFILES: readonly MethodProfileDefinition[] = [
  { schemaVersion: 1, id: 'repoctopus.open', version: '1.0.0', ruleIds: [] },
  {
    schemaVersion: 1,
    id: 'repoctopus.design',
    version: '1.0.0',
    ruleIds: RULES.map((rule) => rule.id),
  },
  {
    schemaVersion: 1,
    id: 'repoctopus.build',
    version: '1.0.0',
    ruleIds: [
      'tasks.tracer-bullet-slices',
      'tasks.explicit-blocking-edges',
      'tasks.expand-contract-wide-refactors',
    ],
  },
  {
    schemaVersion: 1,
    id: 'repoctopus.verify',
    version: '1.0.0',
    ruleIds: ['tasks.verifiable-acceptance'],
  },
  { schemaVersion: 1, id: 'repoctopus.archive', version: '1.0.0', ruleIds: [] },
];

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export class MethodProfileRegistry {
  private readonly rules = new Map(RULES.map((rule) => [rule.id, rule]));
  private readonly profiles = new Map(
    PROFILES.map((profile) => [`${profile.id}@${profile.version}`, profile]),
  );

  constructor() {
    if (this.rules.size !== RULES.length || this.profiles.size !== PROFILES.length) {
      throw new Error('Method Profile registry contains duplicate identities');
    }
    for (const profile of PROFILES) {
      for (const ruleId of profile.ruleIds) {
        if (!this.rules.has(ruleId)) {
          throw new Error(`Method Profile ${profile.id} references unknown rule: ${ruleId}`);
        }
      }
    }
  }

  snapshot(id: string, version: string): MethodProfileSnapshot {
    const profile = this.profiles.get(`${id}@${version}`);
    if (!profile) throw new Error(`Unknown Method Profile: ${id}@${version}`);
    const rules = profile.ruleIds.map((ruleId) => structuredClone(this.rules.get(ruleId)!));
    const stable = { schemaVersion: 1 as const, id, version, rules };
    return {
      id,
      version,
      digest: sha256(stable),
      sourceDigests: [...new Set(rules.flatMap((rule) => rule.sourceDigests))].sort(),
      ruleIds: [...profile.ruleIds],
    };
  }

  assemble(input: {
    profile: MethodProfileSnapshot;
    phase: ChangePhase;
    artifactKinds: readonly Exclude<SpecificationArtifactKind, 'verification'>[];
  }): { profile: MethodProfileSnapshot; rules: MethodRuleDefinition[] } {
    const expected = this.snapshot(input.profile.id, input.profile.version);
    if (canonicalJson(expected) !== canonicalJson(input.profile)) {
      throw new Error(`Method Profile snapshot drifted: ${input.profile.id}`);
    }
    const allowedArtifacts = new Set(input.artifactKinds);
    const rules = expected.ruleIds
      .map((ruleId) => this.rules.get(ruleId)!)
      .filter(
        (rule) =>
          rule.phases.includes(input.phase) &&
          rule.artifactKinds.some((kind) => allowedArtifacts.has(kind)),
      )
      .map((rule) => structuredClone(rule));
    return { profile: expected, rules };
  }
}

export const BUILTIN_METHOD_PROFILE_REGISTRY = new MethodProfileRegistry();
