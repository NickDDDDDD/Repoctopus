import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import SkillRegistry, {
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
  type SkillProviderControl,
} from '@deepseek-ai/dsh-skill';
import { describe, expect, it } from 'vitest';

function candidate(provider: string, name: string, rank: number, content = name): SkillCandidate {
  return {
    name,
    description: `${name} description`,
    invocation: { modelInvocable: true, userInvocable: true },
    provider,
    source: provider,
    rank,
    locator: content,
  };
}

function provider(name: string, candidates: () => readonly SkillCandidate[]): SkillProvider {
  return {
    name,
    list() {
      return Promise.resolve([...candidates()]);
    },
    get(value) {
      return Promise.resolve({
        ...value,
        content: String(value.locator),
      } satisfies SkillDefinition);
    },
  };
}

describe('DSH Skill Registry contract', () => {
  it('uses rank within a layer and lets the nearest scope replace the global winner', async () => {
    const context = new Context();
    await context.plugin(SkillRegistry);
    context.skills.registerProvider(() =>
      provider('global-low', () => [candidate('global-low', 'tdd', 50, 'global low')]),
    );
    context.skills.registerProvider(() =>
      provider('global-high', () => [candidate('global-high', 'tdd', 10, 'global high')]),
    );
    expect((await context.skills.get('tdd'))?.content).toBe('global high');

    const scope = createScope(context, {});
    const scopedSkills = scope.ctx.get('skills')!;
    scopedSkills.registerProvider(() =>
      provider('project', () => [candidate('project', 'tdd', 999, 'project')]),
    );
    expect((await scopedSkills.get('tdd', { scope: {} }))?.content).not.toBe('project');

    const key = {};
    const projectScope = createScope(context, key);
    projectScope.ctx
      .get('skills')!
      .registerProvider(() =>
        provider('project-two', () => [candidate('project-two', 'tdd', 999, 'project')]),
      );
    expect((await context.skills.get('tdd', { scope: key }))?.content).toBe('project');
    await Promise.all([scope.dispose(), projectScope.dispose(), context.fiber.dispose()]);
  });

  it('does not cache incomplete discovery and invalidates completed catalogs', async () => {
    const context = new Context();
    await context.plugin(SkillRegistry);
    let control: SkillProviderControl | undefined;
    let calls = 0;
    let content = 'one';
    context.skills.registerProvider((value) => {
      control = value;
      return {
        name: 'mutable',
        list() {
          calls += 1;
          return Promise.resolve({
            candidates: [candidate('mutable', 'tdd', 1, content)],
            complete: calls > 1,
          });
        },
        get(value) {
          return Promise.resolve({ ...value, content: String(value.locator) });
        },
      };
    });
    expect((await context.skills.snapshot()).complete).toBe(false);
    expect((await context.skills.snapshot()).complete).toBe(true);
    expect(calls).toBe(2);
    await context.skills.snapshot();
    expect(calls).toBe(2);
    content = 'two';
    control!.invalidate();
    expect((await context.skills.get('tdd'))?.content).toBe('two');
    expect(calls).toBe(3);
    await context.fiber.dispose();
  });

  it('cancels uncooperative providers and removes a provider with its Fiber', async () => {
    const context = new Context();
    await context.plugin(SkillRegistry);
    const fiber = context.plugin(
      Object.assign(
        (pluginContext: Context) => {
          pluginContext.skills.registerProvider(() =>
            provider('fiber-provider', () => [candidate('fiber-provider', 'fiber-skill', 1)]),
          );
        },
        { inject: ['skills'] },
      ),
    );
    await fiber;
    expect((await context.skills.list()).some((skill) => skill.name === 'fiber-skill')).toBe(true);
    await fiber.dispose();
    expect((await context.skills.list()).some((skill) => skill.name === 'fiber-skill')).toBe(false);

    context.skills.registerProvider(() => ({
      name: 'blocked',
      list: () => new Promise<SkillCandidate[]>(() => {}),
      get: () => Promise.resolve(undefined),
    }));
    const abort = new AbortController();
    const waiting = context.skills.list({ signal: abort.signal });
    abort.abort(new Error('cancelled by test'));
    await expect(waiting).rejects.toThrow('cancelled by test');
    await context.fiber.dispose();
  });
});
