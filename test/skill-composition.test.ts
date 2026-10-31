import { describe, expect, it } from 'vitest';

import {
  compileEffectiveSkillComposition,
  type SkillCompositionCatalogEntry,
} from '../domains/skill/composition.js';
import type { ChangeLifecycleDefinition } from '../domains/change-lifecycle/transition.js';
import type { TeamSkillBindingConfig } from '../domains/project-configuration/types.js';

const digest = (value: string): `sha256:${string}` =>
  `sha256:${value.padStart(64, value).slice(0, 64)}`;

function catalogEntry(
  name: string,
  options: Partial<SkillCompositionCatalogEntry> = {},
): SkillCompositionCatalogEntry {
  return {
    snapshot: {
      schemaVersion: 1,
      name,
      provider: options.snapshot?.provider ?? 'team-provider',
      invocation: options.snapshot?.invocation ?? { modelInvocable: true, userInvocable: true },
      contentDigest: options.snapshot?.contentDigest ?? digest(name[0] ?? 'a'),
      resourceManifestDigest:
        options.snapshot?.resourceManifestDigest ?? digest(name.at(-1) ?? 'b'),
    },
    source: options.source ?? 'project-agents',
    artifactProtocolOwner: options.artifactProtocolOwner ?? false,
    artifactKinds: options.artifactKinds ?? [],
    requestedCapabilities: options.requestedCapabilities ?? [],
  };
}

function definition(): ChangeLifecycleDefinition {
  return {
    schemaVersion: 3,
    id: 'test-change',
    version: '1.0.0',
    phases: [
      {
        phase: 'design',
        workKinds: ['specification.plan'],
        requiredValidatorProfiles: ['design.valid'],
        extensionCheckpoints: ['design.after-validation'],
      },
    ],
    works: [
      {
        kind: 'specification.plan',
        phase: 'design',
        actionSkill: { name: 'repoctopus-design-change' },
        augmentationSkills: [{ name: 'codebase-design' }],
        augmentationSlots: [
          {
            id: 'design-method',
            defaultSkill: { name: 'codebase-design' },
            replaceable: true,
            contract: { modelInvocable: true, artifactProtocolOwner: false },
          },
        ],
        methodProfile: {
          id: 'design',
          version: '1.0.0',
          digest: digest('1'),
          sourceDigests: [],
          ruleIds: [],
        },
        capabilities: ['repository.read'],
        sideEffectClass: 'none',
        writeScopes: [],
        outputContract: { artifactKinds: [], trackerPublish: false },
        validatorProfile: { id: 'design.valid', version: '1.0.0', digest: digest('2') },
        checkpoint: 'design.after-validation',
      },
    ],
    transitions: [],
    buildProtocol: {
      schemaVersion: 1,
      actions: [],
      policies: {
        executionModes: ['autonomous'],
        tddModes: ['direct'],
        reviewModes: ['standard'],
        isolations: ['current'],
        allowRuntimeModeSwitch: false,
      },
    },
  };
}

const bindings: TeamSkillBindingConfig[] = [
  {
    id: 'team-guidance',
    target: 'specification.plan',
    role: 'guidance',
    skill: 'team-guidance',
    order: 20,
  },
  {
    id: 'team-design-method',
    target: 'specification.plan',
    role: 'augmentation-replacement',
    skill: 'team-design-method',
    slot: 'design-method',
    order: 10,
  },
];

const catalog = [
  catalogEntry('repoctopus-design-change', {
    source: 'bundled',
    snapshot: { provider: 'repoctopus-lifecycle' } as never,
  }),
  catalogEntry('codebase-design', {
    source: 'bundled',
    snapshot: { provider: 'matt-builtins' } as never,
  }),
  catalogEntry('team-guidance'),
  catalogEntry('team-design-method'),
];

describe('effective team Skill composition', () => {
  it('compiles a deterministic ordered Work composition with explicit roles', () => {
    const first = compileEffectiveSkillComposition({
      definition: definition(),
      bindings,
      catalog,
    });
    const second = compileEffectiveSkillComposition({
      definition: definition(),
      bindings: [...bindings].reverse(),
      catalog: [...catalog].reverse(),
    });

    expect(second.digest).toBe(first.digest);
    expect(first.works).toHaveLength(1);
    expect(
      first.works[0]?.layers.map(({ role, skill, bindingId, slotId }) => ({
        role,
        skill: skill.name,
        bindingId,
        slotId,
      })),
    ).toEqual([
      {
        role: 'action',
        skill: 'repoctopus-design-change',
        bindingId: null,
        slotId: null,
      },
      {
        role: 'team-replacement',
        skill: 'team-design-method',
        bindingId: 'team-design-method',
        slotId: 'design-method',
      },
      {
        role: 'team-guidance',
        skill: 'team-guidance',
        bindingId: 'team-guidance',
        slotId: null,
      },
    ]);
  });

  it.each([
    {
      label: 'unknown Work target',
      mutate: (input: TeamSkillBindingConfig[]) => [{ ...input[0]!, target: 'unknown.work' }],
      error: /unknown lifecycle Work/iu,
    },
    {
      label: 'unknown replacement slot',
      mutate: (input: TeamSkillBindingConfig[]) => [{ ...input[1]!, slot: 'unknown-method' }],
      error: /unknown augmentation slot/iu,
    },
    {
      label: 'duplicate replacement',
      mutate: (input: TeamSkillBindingConfig[]) => [
        input[1]!,
        { ...input[1]!, id: 'second-replacement', skill: 'team-guidance' },
      ],
      error: /multiple replacements/iu,
    },
  ])('rejects $label', ({ mutate, error }) => {
    expect(() =>
      compileEffectiveSkillComposition({
        definition: definition(),
        bindings: mutate(bindings),
        catalog,
      }),
    ).toThrow(error);
  });

  it('rejects user-only, non-invocable and artifact-owning team Skills', () => {
    for (const candidate of [
      catalogEntry('team-guidance', { source: 'user-agents' }),
      catalogEntry('team-guidance', {
        snapshot: { invocation: { modelInvocable: false, userInvocable: true } } as never,
      }),
      catalogEntry('team-guidance', { artifactProtocolOwner: true }),
      catalogEntry('team-guidance', { requestedCapabilities: ['repository.write'] }),
    ]) {
      expect(() =>
        compileEffectiveSkillComposition({
          definition: definition(),
          bindings: [bindings[0]!],
          catalog: [
            ...catalog.filter((entry) => entry.snapshot.name !== 'team-guidance'),
            candidate,
          ],
        }),
      ).toThrow(/team Skill|model-invocable|artifact protocol/iu);
    }
  });

  it('rejects personal same-name lifecycle Skills and Provider replacement of an Action', () => {
    for (const candidate of [
      catalogEntry('codebase-design', { source: 'user-agents' }),
      catalogEntry('repoctopus-design-change', { source: 'project-agents' }),
    ]) {
      expect(() =>
        compileEffectiveSkillComposition({
          definition: definition(),
          bindings: [],
          catalog: [
            ...catalog.filter((entry) => entry.snapshot.name !== candidate.snapshot.name),
            candidate,
          ],
        }),
      ).toThrow(/user source|may not be replaced/iu);
    }
  });
});
