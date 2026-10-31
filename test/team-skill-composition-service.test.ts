import { Context } from '@deepseek-ai/cordis';
import SkillRegistry, {
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill';
import { afterEach, describe, expect, it } from 'vitest';

import { BUILTIN_CHANGE_LIFECYCLE_DEFINITION } from '../domains/change-lifecycle/definition.js';
import { TeamSkillComposition } from '../services/team-skill-composition.js';

const contexts: Context[] = [];
afterEach(async () => Promise.all(contexts.splice(0).map((context) => context.fiber.dispose())));

function provider(
  input: {
    teamSource?: SkillCandidate['source'];
    teamContent?: string;
  } = {},
): SkillProvider {
  const builtins = BUILTIN_CHANGE_LIFECYCLE_DEFINITION.works.flatMap((work) => [
    ...(work.actionSkill ? [work.actionSkill.name] : []),
    ...work.augmentationSkills.map((skill) => skill.name),
  ]);
  const candidates = [...new Set([...builtins, 'team-guide', 'team-design'])].map(
    (name): SkillCandidate => ({
      name,
      description: `${name} description`,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'test-project-provider',
      source: name.startsWith('team-') ? (input.teamSource ?? 'project-dsh') : ('bundled' as const),
      rank: 1,
      locator: name,
    }),
  );
  return {
    name: 'test-project-provider',
    list: () => Promise.resolve(candidates),
    get(candidate) {
      return Promise.resolve({
        ...candidate,
        content:
          candidate.name === 'team-guide' && input.teamContent
            ? input.teamContent
            : `${candidate.name} instructions`,
      } satisfies SkillDefinition);
    },
  };
}

async function service(input: Parameters<typeof provider>[0] = {}) {
  const context = new Context();
  contexts.push(context);
  await context.plugin(SkillRegistry);
  context.skills.registerProvider(() => provider(input));
  return new TeamSkillComposition(context, {
    workspaceRoot: 'C:/portable/workspace',
    bindings: [
      {
        id: 'design-guide',
        target: 'specification.plan',
        role: 'guidance',
        skill: 'team-guide',
        order: 20,
      },
      {
        id: 'design-method',
        target: 'specification.plan',
        role: 'augmentation-replacement',
        skill: 'team-design',
        order: 10,
        slot: 'design-method',
      },
    ],
  });
}

describe('TeamSkillComposition service', () => {
  it('resolves project Provider content and freezes replacement and guidance roles', async () => {
    const first = await service();
    const resolved = await first.resolveWork(
      BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      'specification.plan',
    );

    expect(
      resolved.skillComposition.layers.map((layer) => ({
        role: layer.role,
        bindingId: layer.bindingId,
        slotId: layer.slotId,
        name: layer.skill.name,
      })),
    ).toEqual([
      {
        role: 'action',
        bindingId: null,
        slotId: null,
        name: 'repoctopus-design-change',
      },
      {
        role: 'team-replacement',
        bindingId: 'design-method',
        slotId: 'design-method',
        name: 'team-design',
      },
      {
        role: 'team-guidance',
        bindingId: 'design-guide',
        slotId: null,
        name: 'team-guide',
      },
    ]);
    expect(resolved.augmentationSkills.map((skill) => skill.name)).toEqual([
      'team-design',
      'team-guide',
    ]);
    expect(resolved.effectiveComposition.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects a team binding that resolves only from a personal Skill source', async () => {
    const composition = await service({ teamSource: 'user-agents' });
    await expect(composition.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION)).rejects.toThrow(
      /user source/u,
    );
  });

  it('changes the frozen digest when active Provider content drifts', async () => {
    const first = await service({ teamContent: 'team guide v1' });
    const second = await service({ teamContent: 'team guide v2' });
    await expect(first.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION)).resolves.not.toEqual(
      await second.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION),
    );
  });
});
