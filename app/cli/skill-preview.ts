import type { Context } from '@deepseek-ai/cordis';
import { isModelInvocable } from '@deepseek-ai/dsh-skill';

import { buildActionSkillComposition } from '../../domains/change-lifecycle/build-work.js';
import type { BuildTddMode } from '../../domains/change-lifecycle/build-protocol.js';
import { assertAugmentationSkillProtocol } from '../../domains/change-lifecycle/work-context.js';
import { BUILTIN_DIAGNOSTIC_SKILL } from '../../domains/skill/builtin-workflow-skills.js';
import { skillProtocolMetadata } from '../../services/team-skill-composition.js';

function workVariants(kind: string): Array<{
  tddMode: BuildTddMode | null;
  augmentationSkills: readonly string[];
}> {
  switch (kind) {
    case 'build.execute':
      return (['tdd', 'direct'] as const).map((tddMode) => ({
        tddMode,
        ...buildActionSkillComposition({ action: 'execute', tddMode }),
      }));
    case 'build.check':
    case 'build.plan':
      return [
        {
          tddMode: null,
          ...buildActionSkillComposition({
            action: kind === 'build.check' ? 'check' : 'plan',
            tddMode: 'direct',
          }),
        },
      ];
    default:
      return [{ tddMode: null, augmentationSkills: [] }];
  }
}

export async function previewWorkSkills(ctx: Context, workspace: string) {
  const { definition } = ctx.lifecycleDefinitions.current();
  const compiler = ctx.teamSkillComposition;
  const works = definition.works.map(({ kind, phase, outputContract }) => ({
    kind,
    phase,
    planningArtifacts: outputContract.artifactKinds.filter((kind) => kind !== 'verification'),
    variants: workVariants(kind),
  }));
  const additionalNames = works.flatMap(({ variants }) =>
    variants.flatMap(({ augmentationSkills }) => augmentationSkills),
  );
  const { effectiveComposition, catalog } = await compiler.resolveComposition(
    definition,
    undefined,
    additionalNames,
  );
  const base = new Map(effectiveComposition.works.map((work) => [work.workKind, work]));

  const diagnostic = await ctx.skills.get(BUILTIN_DIAGNOSTIC_SKILL, { cwd: workspace });
  const retryUnavailableReason =
    !diagnostic || !isModelInvocable(diagnostic)
      ? 'Skill cannot be loaded by the model'
      : skillProtocolMetadata(diagnostic).artifactProtocolOwner
        ? 'Diagnostic Skill may not become an action owner'
        : null;
  const buildRetry = {
    condition: 'attempt > 1',
    placement: 'after-augmentations',
    name: BUILTIN_DIAGNOSTIC_SKILL,
    provider: diagnostic?.provider ?? null,
    source: diagnostic?.source ?? null,
    available: retryUnavailableReason === null,
    unavailableReason: retryUnavailableReason,
  };

  return {
    definition: effectiveComposition.definition,
    works: works.map(({ kind, phase, planningArtifacts, variants }) => ({
      kind,
      phase,
      variants: variants.map(({ tddMode, augmentationSkills }) => {
        const dynamic = augmentationSkills.map((name) => catalog.get(name)!);
        const compiled = compiler.withBuiltinAugmentations(base.get(kind)!, dynamic);
        return {
          tddMode,
          layers: compiled.layers.map(
            ({ position, role, skill, bindingId, slotId, replacedSkillName }) => {
              const entry = catalog.get(skill.name)!;
              if (role !== 'action')
                assertAugmentationSkillProtocol(skill.name, entry, planningArtifacts);
              return {
                position,
                role,
                name: skill.name,
                provider: skill.provider,
                source: entry.source,
                bindingId,
                slotId,
                replacedSkillName,
              };
            },
          ),
        };
      }),
      ...(phase === 'build' ? { retrySkill: buildRetry } : {}),
    })),
  };
}

export type WorkSkillPreview = Awaited<ReturnType<typeof previewWorkSkills>>;

export function renderWorkSkillPreview(preview: WorkSkillPreview): string[] {
  return preview.works.flatMap(({ kind, phase, variants, retrySkill }) => [
    `${kind} (${phase})`,
    ...variants.flatMap(({ tddMode, layers }) => [
      ...(tddMode ? [`  TDD mode: ${tddMode}`] : []),
      ...layers.map(
        ({ position, name, role, provider, source, bindingId, slotId }) =>
          `  ${position + 1}. ${name} [${role}] ${provider}/${source}` +
          (bindingId ? ` binding=${bindingId}` : '') +
          (slotId ? ` slot=${slotId}` : ''),
      ),
    ]),
    ...(retrySkill
      ? [
          `  Retry (${retrySkill.condition}, after augmentations): ${retrySkill.name}` +
            (retrySkill.available
              ? ` ${retrySkill.provider}/${retrySkill.source}`
              : ` [unavailable: ${retrySkill.unavailableReason}]`),
        ]
      : []),
  ]);
}
