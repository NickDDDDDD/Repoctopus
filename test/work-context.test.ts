import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';
import {
  assembleWorkExecutionContext,
  WORK_CONTEXT_LAYER_ORDER,
  type ResolvedWorkContextSkill,
} from '../domains/change-lifecycle/work-context.js';
import {
  lifecycleWorkDefinition,
  materializeLifecycleWorkBinding,
} from '../domains/change-lifecycle/work-definition.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import type {
  SpecificationArtifactContext,
  SpecificationPhaseContext,
} from '../domains/specification/types.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';

const digest = (value: string) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}` as const;

function snapshot(name: string): SkillUsageSnapshot {
  return {
    schemaVersion: 1,
    name,
    provider: 'test',
    invocation: { modelInvocable: true, userInvocable: true },
    contentDigest: digest(`${name} content`),
    resourceManifestDigest: digest(`${name} resources`),
  };
}

function skill(
  name: string,
  overrides: Partial<ResolvedWorkContextSkill> = {},
): ResolvedWorkContextSkill {
  return {
    snapshot: snapshot(name),
    content: `${name} content`,
    artifactProtocolOwner: false,
    artifactKinds: [],
    ...overrides,
  };
}

function work(kind: string): WorkDescriptor {
  const definition = lifecycleWorkDefinition(BUILTIN_CHANGE_LIFECYCLE_DEFINITION, kind);
  const binding = materializeLifecycleWorkBinding({
    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
    kind,
    ...(definition.actionSkill ? { actionSkill: snapshot(definition.actionSkill.name) } : {}),
    augmentationSkills: definition.augmentationSkills.map((reference) => snapshot(reference.name)),
    workspaceRepositoryId: 'workspace',
    repositoryIds: ['workspace', 'backend'],
  });
  const descriptor: WorkDescriptor = {
    schemaVersion: 2,
    workId: `${definition.phase}:${kind}`,
    checkEpoch: 0,
    ...binding,
    inputDigest: digest(`${kind} input`),
  };
  if (kind === 'build.execute') descriptor.augmentationSkills = [snapshot('tdd')];
  return descriptor;
}

function artifact(
  id: string,
  kind: SpecificationArtifactContext['kind'],
): SpecificationArtifactContext {
  const instruction = `${kind} official instructions`;
  const template = `${kind} official template`;
  return {
    id,
    kind,
    instruction,
    template,
    instructionDigest: digest(canonicalJson(instruction)),
    templateDigest: digest(canonicalJson(template)),
  };
}

const planningArtifacts = [
  artifact('proposal', 'proposal'),
  artifact('specs', 'delta-specs'),
  artifact('design', 'design'),
  artifact('tasks', 'tasks'),
];

function assemble(
  descriptor: WorkDescriptor,
  overrides: Partial<Parameters<typeof assembleWorkExecutionContext>[0]> = {},
  omitActionSkill = false,
) {
  const specificationArtifacts = planningArtifacts.filter((artifact) =>
    descriptor.outputContract.artifactKinds.includes(artifact.kind),
  );
  const phaseStable = {
    schemaVersion: 1 as const,
    phase: descriptor.phase,
    provider: {
      id: 'openspec',
      version: '1.0.0',
      protocolVersion: 'repoctopus.specification/v1alpha1' as const,
    },
    instruction: `Official ${descriptor.phase} protocol`,
    allowedOperations: ['inspect-change'] as const,
    artifacts: specificationArtifacts,
  };
  const specificationPhase: SpecificationPhaseContext = {
    ...phaseStable,
    digest: digest(canonicalJson(phaseStable)),
  };
  return assembleWorkExecutionContext({
    work: descriptor,
    runtimeContract: 'Runtime contract',
    ...(descriptor.actionSkill && !omitActionSkill
      ? { actionSkill: skill(descriptor.actionSkill.name) }
      : {}),
    specificationArtifacts,
    specificationPhase,
    augmentationSkills: descriptor.augmentationSkills.map((entry) => skill(entry.name)),
    changeInputs: { changeId: 'context-test' },
    ...overrides,
  });
}

describe('Work execution context', () => {
  it.each([
    [
      'change.intake',
      [
        'runtime-contract',
        'action-skill',
        'specification-protocol',
        'specification-protocol',
        'specification-protocol',
        'specification-protocol',
        'specification-protocol',
        'augmentation-skill',
        'method-profile',
        'change-inputs',
      ],
    ],
    [
      'specification.plan',
      [
        'runtime-contract',
        'action-skill',
        'specification-protocol',
        'specification-protocol',
        'specification-protocol',
        'specification-protocol',
        'specification-protocol',
        'augmentation-skill',
        'method-profile',
        'change-inputs',
      ],
    ],
    [
      'build.execute',
      [
        'runtime-contract',
        'action-skill',
        'specification-protocol',
        'augmentation-skill',
        'method-profile',
        'change-inputs',
      ],
    ],
    [
      'evidence.verify',
      [
        'runtime-contract',
        'action-skill',
        'specification-protocol',
        'augmentation-skill',
        'method-profile',
        'change-inputs',
      ],
    ],
    [
      'delivery.publish',
      [
        'runtime-contract',
        'action-skill',
        'specification-protocol',
        'method-profile',
        'change-inputs',
      ],
    ],
  ])('loads the fixed %s phase composition in priority order', (kind, expected) => {
    const context = assemble(work(kind));
    expect(context.layers.map((entry) => entry.kind)).toEqual(expected);
    expect(context.layers.map((entry) => entry.priority)).toEqual(
      [...context.layers].map((entry) => WORK_CONTEXT_LAYER_ORDER.indexOf(entry.kind) + 1),
    );
  });

  it('adds only the fixed diagnosing-bugs method for a Build retry', () => {
    const descriptor = work('build.execute');
    const context = assemble(descriptor, { diagnosticSkill: skill('diagnosing-bugs') });
    expect(
      context.layers
        .filter((entry) => entry.kind === 'augmentation-skill')
        .map((entry) => entry.source),
    ).toEqual(['tdd', 'diagnosing-bugs']);
  });

  it('fails before execution for a missing dependency, second owner, or artifact conflict', () => {
    const build = work('build.execute');
    expect(() => assemble(build, {}, true)).toThrow(/missing or drifted/u);
    expect(() =>
      assemble(build, {
        augmentationSkills: [skill('tdd', { artifactProtocolOwner: true })],
      }),
    ).toThrow(/may not become an action owner/u);
    const design = work('specification.plan');
    expect(() => assemble(design, { actionSkill: skill('tdd') })).toThrow(/missing or drifted/u);
    expect(() =>
      assemble(design, {
        specificationArtifacts: planningArtifacts.map((entry, index) =>
          index === 0 ? { ...entry, instruction: 'drifted' } : entry,
        ),
      }),
    ).toThrow(/instructions drifted/u);
  });
});
