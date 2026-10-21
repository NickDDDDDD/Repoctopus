import { createHash } from 'node:crypto';

import type { Context, Plugin } from '@deepseek-ai/cordis';
import type { SkillDefinition, SkillSummary } from '@deepseek-ai/dsh-skill';

import { projectSkills, type SkillProjectionTarget } from '../../platform/skill/projector.js';

type SkillAudience = 'model' | 'user';

interface SkillCommandInput {
  cwd?: string;
  audience?: SkillAudience;
  name?: string;
  target?: SkillProjectionTarget;
  runId?: string;
}

function allowed(skill: Pick<SkillSummary, 'invocation'>, audience: SkillAudience): boolean {
  return audience === 'model' ? skill.invocation.modelInvocable : skill.invocation.userInvocable;
}

function digest(definition: SkillDefinition): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(definition.content).digest('hex')}`;
}

function publicDefinition(definition: SkillDefinition) {
  return {
    name: definition.name,
    description: definition.description,
    ...(definition.whenToUse ? { whenToUse: definition.whenToUse } : {}),
    invocation: definition.invocation,
    source: definition.source,
    provider: definition.provider,
    ...(definition.resourceBase ? { resourceBase: definition.resourceBase } : {}),
    ...(definition.path ? { path: definition.path } : {}),
    contentDigest: digest(definition),
  };
}

const plugin = ((context: Context) => {
  context.effect(() =>
    context.commandRouter.register({
      name: 'skill.list',
      async execute({ input, signal }) {
        const commandInput = input as SkillCommandInput;
        const audience = commandInput.audience ?? 'user';
        const snapshot = await context.skills.snapshot({ cwd: commandInput.cwd, signal });
        const skills = [];
        let complete = snapshot.complete;
        for (const summary of snapshot.skills) {
          if (!allowed(summary, audience)) continue;
          const definition = await context.skills.get(summary.name, {
            cwd: commandInput.cwd,
            signal,
          });
          if (!definition) {
            complete = false;
            continue;
          }
          if (!allowed(definition, audience)) continue;
          skills.push(publicDefinition(definition));
        }
        return {
          apiVersion: 'repoctopus.skill/v1alpha1',
          kind: 'SkillCatalog',
          audience,
          complete,
          skills,
        };
      },
    }),
  );

  context.effect(() =>
    context.commandRouter.register({
      name: 'skill.get',
      async execute({ input, signal }) {
        const commandInput = input as SkillCommandInput;
        const audience = commandInput.audience ?? 'user';
        const name = commandInput.name?.trim();
        if (!name) throw new Error('Skill name is required');
        const summary = (await context.skills.list({ cwd: commandInput.cwd, signal })).find(
          (candidate) => candidate.name === name,
        );
        if (!summary || !allowed(summary, audience)) {
          throw new Error(`Skill is unavailable for ${audience} invocation: ${name}`);
        }
        const definition = await context.skills.get(name, { cwd: commandInput.cwd, signal });
        if (!definition || !allowed(definition, audience)) {
          throw new Error(`Skill is unavailable for ${audience} invocation: ${name}`);
        }
        const workflowRuns = commandInput.runId ? context.get('workflowRuns') : undefined;
        if (commandInput.runId && !workflowRuns) {
          throw new Error('Workflow Run capability is required to bind a Skill snapshot');
        }
        const runSnapshot =
          commandInput.runId && workflowRuns
            ? await workflowRuns.bindSkill(commandInput.runId, definition, signal)
            : undefined;
        return {
          apiVersion: 'repoctopus.skill/v1alpha1',
          kind: 'SkillDefinition',
          audience,
          skill: { ...publicDefinition(definition), content: definition.content },
          ...(runSnapshot ? { runSnapshot } : {}),
        };
      },
    }),
  );

  context.effect(() =>
    context.commandRouter.register({
      name: 'skill.project',
      async execute({ input, signal }) {
        const commandInput = input as SkillCommandInput;
        const workspace = commandInput.cwd;
        if (!workspace) throw new Error('Skill projection workspace is required');
        if (commandInput.target !== 'codex' && commandInput.target !== 'opencode') {
          throw new Error('Skill projection target must be codex or opencode');
        }
        const snapshot = await context.skills.snapshot({ cwd: workspace, signal });
        if (!snapshot.complete) {
          throw new Error('Skill catalog discovery is incomplete; projection was not changed');
        }
        const definitions = [];
        for (const summary of snapshot.skills) {
          const definition = await context.skills.get(summary.name, { cwd: workspace, signal });
          if (!definition) {
            throw new Error(`Skill disappeared while preparing projection: ${summary.name}`);
          }
          definitions.push({ definition, contentDigest: digest(definition) });
        }
        return projectSkills({
          workspace,
          target: commandInput.target,
          skills: definitions,
        });
      },
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'skills'] });

export default plugin;
