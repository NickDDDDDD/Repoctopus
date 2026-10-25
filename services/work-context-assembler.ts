import { Service, type Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill';

import {
  assembleWorkExecutionContext,
  type ResolvedWorkContextSkill,
  type WorkExecutionContext,
} from '../domains/change-lifecycle/work-context.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';

const RUNTIME_CONTRACT = `Repoctopus Runtime owns lifecycle state, claims, capabilities, write scopes, output contracts and validation. Follow the fixed Work binding. Do not create another specification, tracker, task authority or lifecycle transition. Report an Outcome; only Runtime validators and Evidence may advance the Change.`;

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

export class WorkContextAssembler extends Service {
  static inject = ['skills', 'specification'];

  private readonly workspaceRoot: string;

  constructor(context: Context, config: { workspaceRoot?: string } = {}) {
    super(context, 'workContextAssembler');
    this.workspaceRoot = config.workspaceRoot ?? process.cwd();
  }

  async assemble(input: {
    work: WorkDescriptor;
    changeId: string;
    changeInputs: unknown;
    diagnostic?: boolean;
    signal?: AbortSignal;
  }): Promise<WorkExecutionContext> {
    const resolve = async (name: string): Promise<ResolvedWorkContextSkill> => {
      const definition = await this.ctx.skills.get(name, {
        cwd: this.workspaceRoot,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!definition || !isModelInvocable(definition)) {
        throw new Error(`Work context executable Skill is unavailable: ${name}`);
      }
      return {
        snapshot: await snapshotSkillDefinition(definition),
        content: definition.content,
        ...protocolMetadata(definition),
      };
    };
    const planningKinds = input.work.outputContract.artifactKinds.filter(
      (kind) => kind !== 'verification',
    );
    const phaseContext = await this.ctx.specification.phaseContext(
      input.work.phase,
      input.changeId,
      input.signal,
    );
    const specificationArtifacts = planningKinds.map((kind) => {
      const artifact = phaseContext.artifacts.find((candidate) => candidate.kind === kind);
      if (!artifact) throw new Error(`Work context is missing OpenSpec ${kind} instructions`);
      return artifact;
    });
    return assembleWorkExecutionContext({
      work: input.work,
      runtimeContract: RUNTIME_CONTRACT,
      ...(input.work.actionSkill
        ? { actionSkill: await resolve(input.work.actionSkill.name) }
        : {}),
      specificationArtifacts,
      specificationPhase: phaseContext,
      augmentationSkills: await Promise.all(
        input.work.augmentationSkills.map((skill) => resolve(skill.name)),
      ),
      ...(input.diagnostic ? { diagnosticSkill: await resolve('diagnosing-bugs') } : {}),
      changeInputs: input.changeInputs,
    });
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workContextAssembler: WorkContextAssembler;
  }
}
