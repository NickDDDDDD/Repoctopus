import { createHash } from 'node:crypto';

import type { SkillUsageSnapshot } from '../skill/types.js';
import { sameSkillUsageSnapshot } from '../skill/types.js';
import type {
  SpecificationArtifactContext,
  SpecificationPhaseContext,
} from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { BUILTIN_METHOD_PROFILE_REGISTRY, type MethodRuleDefinition } from './method-profile.js';
import type { WorkDescriptor } from './transition.js';
import {
  createEffectiveWorkSkillComposition,
  type EffectiveSkillLayerRole,
} from '../skill/composition.js';

export const WORK_CONTEXT_LAYER_ORDER = [
  'runtime-contract',
  'action-skill',
  'specification-protocol',
  'augmentation-skill',
  'method-profile',
  'change-inputs',
] as const;

export type WorkContextLayerKind = (typeof WORK_CONTEXT_LAYER_ORDER)[number];

export interface WorkSkillResource {
  path: string;
  digest: `sha256:${string}`;
  encoding: 'utf8' | 'base64';
  content: string;
}

export interface ResolvedWorkContextSkill {
  resources?: readonly WorkSkillResource[];
  snapshot: SkillUsageSnapshot;
  content: string;
  artifactProtocolOwner: boolean;
  artifactKinds: readonly string[];
}

export interface WorkContextLayer {
  kind: WorkContextLayerKind;
  priority: number;
  source: string;
  content: string;
  digest: `sha256:${string}`;
  resources?: readonly WorkSkillResource[];
  skillRole?: EffectiveSkillLayerRole;
  bindingId?: string | null;
  slotId?: string | null;
  skillOrder?: number;
  replacedSkillName?: string | null;
}

export interface WorkExecutionContext {
  schemaVersion: 1;
  workId: string;
  layers: WorkContextLayer[];
  digest: `sha256:${string}`;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalDigest(value: unknown): `sha256:${string}` {
  return sha256(canonicalJson(value));
}

function layer(
  kind: WorkContextLayerKind,
  source: string,
  content: string,
  skill?: Pick<
    NonNullable<WorkDescriptor['skillComposition']>['layers'][number],
    'role' | 'bindingId' | 'slotId' | 'position' | 'replacedSkillName'
  >,
  resources?: readonly WorkSkillResource[],
): WorkContextLayer {
  if (!content.trim()) throw new Error(`Work context layer is empty: ${kind}/${source}`);
  return {
    kind,
    priority: WORK_CONTEXT_LAYER_ORDER.indexOf(kind) + 1,
    source,
    content,
    digest: sha256(content),
    ...(resources?.length ? { resources } : {}),
    ...(skill
      ? {
          skillRole: skill.role,
          bindingId: skill.bindingId,
          slotId: skill.slotId,
          skillOrder: skill.position,
          replacedSkillName: skill.replacedSkillName,
        }
      : {}),
  };
}

function assertSkill(
  expected: SkillUsageSnapshot,
  actual: ResolvedWorkContextSkill | undefined,
  role: string,
): ResolvedWorkContextSkill {
  if (!actual || !sameSkillUsageSnapshot(expected, actual.snapshot)) {
    throw new Error(`Work context ${role} Skill is missing or drifted: ${expected.name}`);
  }
  return actual;
}

function methodContent(rules: readonly MethodRuleDefinition[]): string {
  return rules.map((rule) => `[${rule.enforcement}] ${rule.id}: ${rule.statement}`).join('\n');
}

export function assembleWorkExecutionContext(input: {
  work: WorkDescriptor;
  runtimeContract: string;
  actionSkill?: ResolvedWorkContextSkill;
  specificationArtifacts: readonly SpecificationArtifactContext[];
  specificationPhase: SpecificationPhaseContext;
  augmentationSkills: readonly ResolvedWorkContextSkill[];
  diagnosticSkill?: ResolvedWorkContextSkill;
  changeInputs: unknown;
}): WorkExecutionContext {
  const frozenSkillComposition =
    input.work.skillComposition ??
    createEffectiveWorkSkillComposition({
      workKind: input.work.kind,
      layers: [
        ...(input.work.actionSkill
          ? [
              {
                role: 'action' as const,
                origin: 'builtin' as const,
                order: 0,
                bindingId: null,
                slotId: null,
                replacedSkillName: null,
                skill: input.work.actionSkill,
              },
            ]
          : []),
        ...input.work.augmentationSkills.map((skill, index) => ({
          role: 'builtin-augmentation' as const,
          origin: 'builtin' as const,
          order: index + 1,
          bindingId: null,
          slotId: null,
          replacedSkillName: null,
          skill,
        })),
      ],
    });
  const layers: WorkContextLayer[] = [
    layer('runtime-contract', 'repoctopus-runtime', input.runtimeContract),
  ];
  if (input.work.actionSkill) {
    const action = assertSkill(input.work.actionSkill, input.actionSkill, 'action');
    const compositionLayer = frozenSkillComposition.layers.find(
      (candidate) => candidate.role === 'action',
    );
    if (!compositionLayer) throw new Error('Work context action composition is missing');
    layers.push(
      layer(
        'action-skill',
        action.snapshot.name,
        action.content,
        compositionLayer,
        action.resources,
      ),
    );
  } else if (input.actionSkill) {
    throw new Error('Work context contains a second, undeclared action owner');
  }

  const expectedArtifacts = input.work.outputContract.artifactKinds.filter(
    (kind) => kind !== 'verification',
  );
  const observedArtifacts = input.specificationArtifacts.map((artifact) => artifact.kind);
  if (canonicalJson(expectedArtifacts) !== canonicalJson(observedArtifacts)) {
    throw new Error(
      'Work context Specification artifact protocol does not match the output contract',
    );
  }
  const phaseStable = {
    schemaVersion: input.specificationPhase.schemaVersion,
    phase: input.specificationPhase.phase,
    provider: input.specificationPhase.provider,
    instruction: input.specificationPhase.instruction,
    allowedOperations: input.specificationPhase.allowedOperations,
    artifacts: input.specificationPhase.artifacts,
  };
  if (
    input.specificationPhase.phase !== input.work.phase ||
    sha256(canonicalJson(phaseStable)) !== input.specificationPhase.digest
  ) {
    throw new Error('Work context Specification phase protocol is missing or drifted');
  }
  layers.push(
    layer(
      'specification-protocol',
      `${input.specificationPhase.provider.id}:${input.work.phase}`,
      `${input.specificationPhase.instruction}\n\nAllowed operations:\n${input.specificationPhase.allowedOperations
        .map((operation) => `- ${operation}`)
        .join('\n')}`,
    ),
  );
  for (const artifact of input.specificationArtifacts) {
    if (
      canonicalDigest(artifact.instruction) !== artifact.instructionDigest ||
      canonicalDigest(artifact.template) !== artifact.templateDigest
    ) {
      throw new Error(`Work context OpenSpec instructions drifted: ${artifact.id}`);
    }
    layers.push(
      layer(
        'specification-protocol',
        artifact.id,
        `# Instructions\n${artifact.instruction}\n\n# Template\n${artifact.template}`,
      ),
    );
  }

  if (input.augmentationSkills.length !== input.work.augmentationSkills.length) {
    throw new Error('Work context augmentation Skill count does not match the Work binding');
  }
  input.work.augmentationSkills.forEach((expected, index) => {
    const augmentation = assertSkill(
      expected,
      input.augmentationSkills[index],
      `augmentation ${index + 1}`,
    );
    if (augmentation.artifactProtocolOwner) {
      throw new Error(
        `Augmentation Skill may not become an action owner: ${augmentation.snapshot.name}`,
      );
    }
    if (augmentation.artifactKinds.some((kind) => expectedArtifacts.includes(kind as never))) {
      throw new Error(
        `Augmentation Skill conflicts with the Specification artifact protocol: ${augmentation.snapshot.name}`,
      );
    }
    const compositionLayer = frozenSkillComposition.layers.filter(
      (candidate) => candidate.role !== 'action',
    )[index];
    if (!compositionLayer || compositionLayer.skill.name !== augmentation.snapshot.name) {
      throw new Error(`Work context augmentation composition is drifted at index ${index}`);
    }
    layers.push(
      layer(
        'augmentation-skill',
        augmentation.snapshot.name,
        augmentation.content,
        compositionLayer,
        augmentation.resources,
      ),
    );
  });
  if (input.diagnosticSkill) {
    if (input.work.phase !== 'build' || input.diagnosticSkill.snapshot.name !== 'diagnosing-bugs') {
      throw new Error('Work context contains an undeclared diagnostic method');
    }
    if (input.diagnosticSkill.artifactProtocolOwner) {
      throw new Error('Diagnostic Skill may not become an action owner');
    }
    layers.push(
      layer(
        'augmentation-skill',
        input.diagnosticSkill.snapshot.name,
        input.diagnosticSkill.content,
        undefined,
        input.diagnosticSkill.resources,
      ),
    );
  }

  const method = BUILTIN_METHOD_PROFILE_REGISTRY.assemble({
    profile: input.work.methodProfile,
    phase: input.work.phase,
    artifactKinds: expectedArtifacts,
  });
  layers.push(
    layer(
      'method-profile',
      `${method.profile.id}@${method.profile.version}`,
      method.rules.length > 0 ? methodContent(method.rules) : 'No additional Method Profile rules.',
    ),
  );
  layers.push(layer('change-inputs', input.work.workId, canonicalJson(input.changeInputs)));

  const priorities = layers.map((entry) => entry.priority);
  if (priorities.some((priority, index) => index > 0 && priority < priorities[index - 1]!)) {
    throw new Error('Work context layer priority is not monotonic');
  }
  const stable = {
    schemaVersion: 1 as const,
    workId: input.work.workId,
    layers: layers.map((entry) => ({
      kind: entry.kind,
      priority: entry.priority,
      source: entry.source,
      digest: entry.digest,
      ...(entry.resources
        ? { resources: entry.resources.map(({ path, digest }) => ({ path, digest })) }
        : {}),
    })),
  };
  return { ...stable, layers, digest: sha256(canonicalJson(stable)) };
}
