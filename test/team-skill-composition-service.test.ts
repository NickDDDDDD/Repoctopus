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
  const candidates = [...new Set([...builtins, 'tdd', 'team-guide', 'team-design'])].map(
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

async function service(
  input: Parameters<typeof provider>[0] = {},
  workspaceRoot = 'C:/portable/workspace',
) {
  const context = new Context();
  contexts.push(context);
  await context.plugin(SkillRegistry);
  context.skills.registerProvider(() => provider(input));
  return new TeamSkillComposition(context, {
    workspaceRoot,
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
      {
        id: 'build-guide',
        target: 'build.execute',
        role: 'guidance',
        skill: 'team-guide',
        order: 20,
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
    expect(resolved.effectiveComposition.digest).toBe(
      'sha256:cd5d7312f661a3fbc7a5f9b2c82bd8710f4b65a8aace894ab4e7aebe7dbacb7b',
    );
  });

  it('rejects a team binding that resolves only from a personal Skill source', async () => {
    const composition = await service({ teamSource: 'user-agents' });
    await expect(composition.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION)).rejects.toThrow(
      /user source/u,
    );
  });

  it('materializes Open, Design and Build packets from one frozen composition', async () => {
    const composition = await service();
    const open = await composition.resolveWork(
      BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      'change.intake',
    );
    const design = await composition.resolveWork(
      BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      'specification.plan',
    );
    const build = await composition.resolveWork(
      BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      'build.execute',
      undefined,
      ['tdd'],
    );

    expect(open.skillComposition.layers.map((layer) => layer.role)).toEqual([
      'action',
      'builtin-augmentation',
    ]);
    expect(design.skillComposition.layers.map((layer) => layer.role)).toEqual([
      'action',
      'team-replacement',
      'team-guidance',
    ]);
    expect(build.skillComposition.layers.map((layer) => [layer.role, layer.skill.name])).toEqual([
      ['action', 'repoctopus-build-execute'],
      ['builtin-augmentation', 'tdd'],
      ['team-guidance', 'team-guide'],
    ]);
    expect(new Set([open, design, build].map((item) => item.effectiveComposition.digest))).toEqual(
      new Set([open.effectiveComposition.digest]),
    );
  });

  it('changes the frozen digest when active Provider content drifts', async () => {
    const first = await service({ teamContent: 'team guide v1' });
    const second = await service({ teamContent: 'team guide v2' });
    await expect(first.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION)).resolves.not.toEqual(
      await second.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION),
    );
  });

  it('keeps the composition identity stable across checkout parent directories', async () => {
    const first = await service({}, 'C:/agent-a/team-platform');
    const second = await service({}, 'D:/agent-b/team-platform');

    expect((await first.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION)).digest).toBe(
      (await second.compile(BUILTIN_CHANGE_LIFECYCLE_DEFINITION)).digest,
    );
  });
});
