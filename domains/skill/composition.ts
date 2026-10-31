import { createHash } from 'node:crypto';

import type { SkillSource } from '@deepseek-ai/dsh-skill';

import type { ChangeLifecycleDefinition } from '../change-lifecycle/transition.js';
import type { TeamSkillBindingConfig } from '../project-configuration/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SkillUsageSnapshot } from './types.js';

export interface SkillCompositionCatalogEntry {
  snapshot: SkillUsageSnapshot;
  source: SkillSource;
  artifactProtocolOwner: boolean;
  artifactKinds: readonly string[];
  requestedCapabilities: readonly string[];
}

export type EffectiveSkillLayerRole =
  | 'action'
  | 'builtin-augmentation'
  | 'team-guidance'
  | 'team-replacement';

export interface EffectiveSkillLayer {
  position: number;
  role: EffectiveSkillLayerRole;
  origin: 'builtin' | 'team';
  order: number;
  bindingId: string | null;
  slotId: string | null;
  replacedSkillName: string | null;
  skill: SkillUsageSnapshot;
}

export type EffectiveSkillLayerInput = Omit<
  EffectiveSkillLayer,
  'position' | 'replacedSkillName'
> & {
  replacedSkillName?: string | null;
};

export interface EffectiveWorkSkillComposition {
  schemaVersion: 1;
  workKind: string;
  layers: readonly EffectiveSkillLayer[];
  digest: `sha256:${string}`;
}

export interface EffectiveSkillComposition {
  schemaVersion: 1;
  definition: { id: string; version: string };
  works: readonly EffectiveWorkSkillComposition[];
  digest: `sha256:${string}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertTeamSkill(
  entry: SkillCompositionCatalogEntry,
  binding: TeamSkillBindingConfig,
): void {
  if (entry.source === 'user-agents' || entry.source === 'user-dsh') {
    throw new Error(`Team Skill ${binding.skill} resolves only from a user source`);
  }
  if (!entry.snapshot.invocation.modelInvocable) {
    throw new Error(`Team Skill ${binding.skill} must be model-invocable`);
  }
  if (entry.artifactProtocolOwner) {
    throw new Error(`Team Skill ${binding.skill} may not own the artifact protocol`);
  }
  const unsafe = entry.requestedCapabilities.filter(
    (capability) => !['repository.read', 'specification.read'].includes(capability),
  );
  if (unsafe.length > 0) {
    throw new Error(
      `Team Skill ${binding.skill} requests capabilities outside the read-only method contract`,
    );
  }
}

function assertCoreSkill(entry: SkillCompositionCatalogEntry, role: 'action' | 'augmentation') {
  if (entry.source === 'user-agents' || entry.source === 'user-dsh') {
    throw new Error(`Lifecycle ${role} Skill ${entry.snapshot.name} resolves from a user source`);
  }
  if (role === 'action' && entry.source !== 'bundled' && entry.source !== 'runtime') {
    throw new Error(
      `Lifecycle Action Skill ${entry.snapshot.name} may not be replaced by a Provider`,
    );
  }
}

function stableLayer(layer: EffectiveSkillLayer) {
  return {
    position: layer.position,
    role: layer.role,
    origin: layer.origin,
    order: layer.order,
    bindingId: layer.bindingId,
    slotId: layer.slotId,
    replacedSkillName: layer.replacedSkillName,
    skill: layer.skill,
  };
}

export function createEffectiveWorkSkillComposition(input: {
  workKind: string;
  layers: readonly EffectiveSkillLayerInput[];
}): EffectiveWorkSkillComposition {
  const stable = {
    schemaVersion: 1 as const,
    workKind: input.workKind,
    layers: input.layers.map((layer, position) =>
      structuredClone(
        stableLayer({ ...layer, position, replacedSkillName: layer.replacedSkillName ?? null }),
      ),
    ),
  };
  return deepFreeze({ ...stable, digest: digest(stable) });
}

export function compileEffectiveSkillComposition(input: {
  definition: ChangeLifecycleDefinition;
  bindings: readonly TeamSkillBindingConfig[];
  catalog: readonly SkillCompositionCatalogEntry[];
}): EffectiveSkillComposition {
  const bindingIds = input.bindings.map((binding) => binding.id);
  if (new Set(bindingIds).size !== bindingIds.length) {
    throw new Error('Team Skill composition contains duplicate binding ids');
  }
  const catalogByName = new Map<string, SkillCompositionCatalogEntry>();
  for (const entry of input.catalog) {
    if (catalogByName.has(entry.snapshot.name)) {
      throw new Error(`Skill catalog resolves ${entry.snapshot.name} more than once`);
    }
    catalogByName.set(entry.snapshot.name, entry);
  }
  const worksByKind = new Map(input.definition.works.map((work) => [work.kind, work] as const));
  for (const binding of input.bindings) {
    if (!worksByKind.has(binding.target)) {
      throw new Error(`Team Skill binding ${binding.id} targets an unknown lifecycle Work`);
    }
    const entry = catalogByName.get(binding.skill);
    if (!entry) throw new Error(`Team Skill ${binding.skill} is unavailable`);
    assertTeamSkill(entry, binding);
  }

  const works = input.definition.works
    .map((work): EffectiveWorkSkillComposition => {
      const action = work.actionSkill ? catalogByName.get(work.actionSkill.name) : undefined;
      if (work.actionSkill && !action) {
        throw new Error(`Lifecycle Action Skill is unavailable: ${work.actionSkill.name}`);
      }
      if (action) assertCoreSkill(action, 'action');
      const slots = work.augmentationSlots ?? [];
      const slotIds = slots.map((slot) => slot.id);
      if (new Set(slotIds).size !== slotIds.length) {
        throw new Error(`Lifecycle Work ${work.kind} contains duplicate augmentation slots`);
      }
      for (const slot of slots) {
        if (!work.augmentationSkills.some((skill) => skill.name === slot.defaultSkill.name)) {
          throw new Error(
            `Lifecycle augmentation slot ${slot.id} does not reference a built-in augmentation`,
          );
        }
      }
      const workBindings = input.bindings.filter((binding) => binding.target === work.kind);
      const replacements = workBindings.filter(
        (binding) => binding.role === 'augmentation-replacement',
      );
      const replacementBySlot = new Map<string, TeamSkillBindingConfig>();
      for (const replacement of replacements) {
        const slot = slots.find((candidate) => candidate.id === replacement.slot);
        if (!slot || !slot.replaceable) {
          throw new Error(
            `Team Skill binding ${replacement.id} targets an unknown augmentation slot`,
          );
        }
        if (replacementBySlot.has(slot.id)) {
          throw new Error(`Team Skill composition contains multiple replacements for ${slot.id}`);
        }
        replacementBySlot.set(slot.id, replacement);
      }

      const layers: EffectiveSkillLayerInput[] = [];
      if (action) {
        layers.push({
          role: 'action',
          origin: 'builtin',
          order: 0,
          bindingId: null,
          slotId: null,
          replacedSkillName: null,
          skill: structuredClone(action.snapshot),
        });
      }
      work.augmentationSkills.forEach((reference, index) => {
        const builtin = catalogByName.get(reference.name);
        if (!builtin)
          throw new Error(`Lifecycle augmentation Skill is unavailable: ${reference.name}`);
        assertCoreSkill(builtin, 'augmentation');
        const slot = slots.find((candidate) => candidate.defaultSkill.name === reference.name);
        const replacement = slot ? replacementBySlot.get(slot.id) : undefined;
        if (replacement) {
          if (!slot) throw new Error('Replacement binding lost its augmentation slot');
          const entry = catalogByName.get(replacement.skill)!;
          if (
            slot.contract.modelInvocable !== entry.snapshot.invocation.modelInvocable ||
            slot.contract.artifactProtocolOwner !== entry.artifactProtocolOwner
          ) {
            throw new Error(`Team Skill ${replacement.skill} does not satisfy slot ${slot.id}`);
          }
          layers.push({
            role: 'team-replacement',
            origin: 'team',
            order: index + 1,
            bindingId: replacement.id,
            slotId: slot.id,
            replacedSkillName: builtin.snapshot.name,
            skill: structuredClone(entry.snapshot),
          });
          return;
        }
        layers.push({
          role: 'builtin-augmentation',
          origin: 'builtin',
          order: index + 1,
          bindingId: null,
          slotId: slot?.id ?? null,
          replacedSkillName: null,
          skill: structuredClone(builtin.snapshot),
        });
      });
      for (const binding of workBindings
        .filter((candidate) => candidate.role === 'guidance')
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))) {
        const entry = catalogByName.get(binding.skill)!;
        if (
          entry.artifactKinds.some((kind) =>
            work.outputContract.artifactKinds.includes(kind as never),
          )
        ) {
          throw new Error(`Team Skill ${binding.skill} conflicts with the artifact protocol`);
        }
        layers.push({
          role: 'team-guidance',
          origin: 'team',
          order: binding.order,
          bindingId: binding.id,
          slotId: null,
          replacedSkillName: null,
          skill: structuredClone(entry.snapshot),
        });
      }
      return createEffectiveWorkSkillComposition({ workKind: work.kind, layers });
    })
    .sort((left, right) => left.workKind.localeCompare(right.workKind));
  const stable = {
    schemaVersion: 1 as const,
    definition: { id: input.definition.id, version: input.definition.version },
    works,
  };
  return deepFreeze({ ...stable, digest: digest(stable) });
}
