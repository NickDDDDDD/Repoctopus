import { Service, type Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ChangeLifecycleDefinition } from '../domains/change-lifecycle/transition.js';
import type { TeamSkillBindingConfig } from '../domains/project-configuration/types.js';
import {
  compileEffectiveSkillComposition,
  createEffectiveWorkSkillComposition,
  type EffectiveSkillComposition,
  type EffectiveWorkSkillComposition,
  type SkillCompositionCatalogEntry,
} from '../domains/skill/composition.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';

interface Config {
  workspaceRoot?: string;
  bindings?: readonly TeamSkillBindingConfig[];
}

function protocolMetadata(definition: SkillDefinition): {
  artifactProtocolOwner: boolean;
  artifactKinds: string[];
} {
  const metadata = definition.metadata?.repoctopus;
  if (!metadata || typeof metadata !== 'object') {
    return { artifactProtocolOwner: false, artifactKinds: [] };
  }
  const record = metadata as Record<string, unknown>;
  return {
    artifactProtocolOwner: record.artifactProtocolOwner === true,
    artifactKinds: Array.isArray(record.artifactKinds)
      ? record.artifactKinds.filter((kind): kind is string => typeof kind === 'string')
      : [],
  };
}

/**
 * Compiles project configuration and provider-resolved Skill bodies into the
 * immutable composition that Runtime binds to every lifecycle Work.
 */
export class TeamSkillComposition extends Service {
  static inject = ['skills'];

  private readonly workspaceRoot: string;
  private readonly bindings: readonly TeamSkillBindingConfig[];

  constructor(context: Context, config: Config = {}) {
    super(context, 'teamSkillComposition');
    this.workspaceRoot = config.workspaceRoot ?? process.cwd();
    this.bindings = Object.freeze(structuredClone(config.bindings ?? []));
  }

  async compile(
    definition: ChangeLifecycleDefinition,
    signal?: AbortSignal,
  ): Promise<EffectiveSkillComposition> {
    const names = new Set<string>();
    for (const work of definition.works) {
      if (work.actionSkill) names.add(work.actionSkill.name);
      for (const skill of work.augmentationSkills) names.add(skill.name);
    }
    for (const binding of this.bindings) names.add(binding.skill);

    const catalog = await Promise.all(
      [...names].sort().map((name) => this.resolveCatalogEntry(name, signal)),
    );
    return compileEffectiveSkillComposition({ definition, bindings: this.bindings, catalog });
  }

  async resolveWork(
    definition: ChangeLifecycleDefinition,
    kind: string,
    signal?: AbortSignal,
    dynamicBuiltinNames: readonly string[] = [],
  ): Promise<{
    effectiveComposition: EffectiveSkillComposition;
    skillComposition: EffectiveWorkSkillComposition;
    actionSkill: SkillUsageSnapshot;
    augmentationSkills: SkillUsageSnapshot[];
  }> {
    const effectiveComposition = await this.compile(definition, signal);
    const compiled = effectiveComposition.works.find((work) => work.workKind === kind);
    if (!compiled) throw new Error(`Skill composition has no lifecycle Work: ${kind}`);

    const dynamic = await Promise.all(
      dynamicBuiltinNames.map(async (name, index) => ({
        role: 'builtin-augmentation' as const,
        origin: 'builtin' as const,
        order: compiled.layers.length + index,
        bindingId: null,
        slotId: null,
        skill: (await this.resolveCatalogEntry(name, signal)).snapshot,
      })),
    );
    const firstGuidance = compiled.layers.findIndex((layer) => layer.role === 'team-guidance');
    const insertion = firstGuidance < 0 ? compiled.layers.length : firstGuidance;
    const skillComposition = createEffectiveWorkSkillComposition({
      workKind: kind,
      layers: [
        ...compiled.layers.slice(0, insertion),
        ...dynamic,
        ...compiled.layers.slice(insertion),
      ].map((layer, index) => ({ ...layer, order: index })),
    });
    const action = skillComposition.layers.filter((layer) => layer.role === 'action');
    if (action.length !== 1) {
      throw new Error(`Lifecycle Work must resolve exactly one Action Skill: ${kind}`);
    }
    return {
      effectiveComposition,
      skillComposition,
      actionSkill: structuredClone(action[0]!.skill),
      augmentationSkills: skillComposition.layers
        .filter((layer) => layer.role !== 'action')
        .map((layer) => structuredClone(layer.skill)),
    };
  }

  private async resolveCatalogEntry(
    name: string,
    signal?: AbortSignal,
  ): Promise<SkillCompositionCatalogEntry> {
    const definition = await this.ctx.skills.get(name, {
      cwd: this.workspaceRoot,
      ...(signal ? { signal } : {}),
    });
    if (!definition || !isModelInvocable(definition)) {
      throw new Error(`Lifecycle executable Skill is unavailable: ${name}`);
    }
    return {
      snapshot: await snapshotSkillDefinition(definition),
      source: definition.source,
      ...protocolMetadata(definition),
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    teamSkillComposition: TeamSkillComposition;
  }
}
