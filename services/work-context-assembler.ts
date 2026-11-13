import { Service, type Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill';

import {
  assembleWorkExecutionContext,
  type ResolvedWorkContextSkill,
  type WorkExecutionContext,
  type WorkSkillResource,
} from '../domains/change-lifecycle/work-context.js';
import type { SkillUsageSnapshot } from '../domains/skill/types.js';
import { sameSkillUsageSnapshot } from '../domains/skill/types.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import { BUILTIN_DIAGNOSTIC_SKILL } from '../domains/skill/builtin-workflow-skills.js';
import { captureWorkSkill } from '../platform/skill/snapshot.js';

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

export function assertWorkSkillResourceBudget(
  layers: readonly { resources?: readonly WorkSkillResource[] }[],
): void {
  let bytes = 0;
  for (const layer of layers) {
    for (const resource of layer.resources ?? []) {
      bytes += Buffer.byteLength(resource.content, resource.encoding);
      if (bytes > 2 * 1024 * 1024)
        throw new Error('Work execution Skill resources exceed the packet limit');
    }
  }
}

export class WorkContextAssembler extends Service {
  static inject = ['skills', 'specification'];

  private readonly workspaceRoot: string;

  constructor(context: Context, config: { workspaceRoot?: string } = {}) {
    super(context, 'workContextAssembler');
    this.workspaceRoot = config.workspaceRoot ?? process.cwd();
  }

  async recoverSkillResources(expected: SkillUsageSnapshot) {
    const skill = await this.resolveSkill(expected.name);
    if (!sameSkillUsageSnapshot(expected, skill.snapshot)) {
      throw new Error(`Bound Skill changed: ${expected.name}`);
    }
    return skill.resources ?? [];
  }

  async assemble(input: {
    work: WorkDescriptor;
    changeId: string;
    changeInputs: unknown;
    diagnostic?: boolean;
    signal?: AbortSignal;
  }): Promise<WorkExecutionContext> {
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
    const context = assembleWorkExecutionContext({
      work: input.work,
      runtimeContract: RUNTIME_CONTRACT,
      ...(input.work.actionSkill
        ? { actionSkill: await this.resolveSkill(input.work.actionSkill.name, input.signal) }
        : {}),
      specificationArtifacts,
      specificationPhase: phaseContext,
      augmentationSkills: await Promise.all(
        input.work.augmentationSkills.map((skill) => this.resolveSkill(skill.name, input.signal)),
      ),
      ...(input.diagnostic
        ? { diagnosticSkill: await this.resolveSkill(BUILTIN_DIAGNOSTIC_SKILL, input.signal) }
        : {}),
      changeInputs: input.changeInputs,
    });
    assertWorkSkillResourceBudget(context.layers);
    return context;
  }

  private async resolveSkill(
    name: string,
    signal?: AbortSignal,
  ): Promise<ResolvedWorkContextSkill> {
    const definition = await this.ctx.skills.get(name, {
      cwd: this.workspaceRoot,
      ...(signal ? { signal } : {}),
    });
    if (!definition || !isModelInvocable(definition)) {
      throw new Error(`Work context executable Skill is unavailable: ${name}`);
    }
    return {
      ...(await captureWorkSkill(definition)),
      content: definition.content,
      ...protocolMetadata(definition),
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workContextAssembler: WorkContextAssembler;
  }
}
