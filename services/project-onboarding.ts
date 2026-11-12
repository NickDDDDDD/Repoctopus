import { realpath } from 'node:fs/promises';

import { Service, type Context } from '@deepseek-ai/cordis';

import type {
  ProjectConfigurationDecisionActor,
  ProjectConfigurationDecisionRequest,
  ProjectConfigurationDecisionResponse,
} from '../domains/project-configuration/onboarding.js';
import {
  applyProjectConfigurationDecision,
  loadPendingProjectConfigurationDecision,
  prepareProjectConfigurationDecision,
  prepareVerifyProfileDecision,
} from '../platform/project-configuration/onboarding.js';
import { detectProjectConfiguration } from '../platform/project-configuration/detect.js';

export interface ApplyProjectConfigurationDecisionInput {
  workspace: string;
  decisionFile: string;
  response: ProjectConfigurationDecisionResponse;
  actor: ProjectConfigurationDecisionActor;
  timestamp: string;
}

export interface DetectProjectConfigurationInput {
  workspace: string;
  scanRoot: string;
  mode?: 'minimal' | 'verify';
  layout?: 'single' | 'multi';
  selectedRepositoryIds?: readonly string[];
  storeId?: string;
  skippedPointerRepositoryIds?: readonly string[];
  entryHosts?: readonly string[];
}

export class ProjectOnboarding extends Service {
  constructor(
    context: Context,
    private readonly config: { workspaceRoot?: string } = {},
  ) {
    super(context, 'projectOnboarding');
  }

  detect(input: DetectProjectConfigurationInput) {
    return detectProjectConfiguration(input);
  }

  async init(input: DetectProjectConfigurationInput) {
    const detected = await this.detect({ ...input, mode: 'minimal' });
    if (!detected.draft.candidateConfig)
      throw new Error('Workspace initialization has no valid candidate');
    return this.prepare({
      workspace: input.workspace,
      draftFile: detected.file,
      completedCandidate: detected.draft.candidateConfig,
    });
  }

  prepare(input: { workspace: string; draftFile: string; completedCandidate: unknown }) {
    return prepareProjectConfigurationDecision(input);
  }

  async configureVerify({
    workspace,
    profile,
    runId,
  }: {
    workspace: string;
    profile: unknown;
    runId?: string;
  }) {
    if (!runId) return prepareVerifyProfileDecision({ workspace, profile });

    const store = this.ctx.get('runStore');
    if (!store || !this.config.workspaceRoot) {
      throw new Error('Run-scoped Verify Profile setup requires a project Runtime');
    }
    const workspaceRoot = await realpath(this.config.workspaceRoot);
    if ((await realpath(workspace)) !== workspaceRoot) {
      throw new Error('Verify Profile setup belongs to another Workspace checkout');
    }
    const state = await store.loadRun(runId);
    const profileId = state.trigger?.facts.verificationProfileId;
    const tasks = state.changeLifecycle?.tasks;
    if (typeof profileId !== 'string' || !tasks?.length) {
      throw new Error('Verify Profile setup requires the Run to have approved Acceptance criteria');
    }
    return prepareVerifyProfileDecision({
      workspace: workspaceRoot,
      profile,
      run: { profileId, tasks },
    });
  }

  load(workspace: string, decisionFile: string): Promise<ProjectConfigurationDecisionRequest> {
    return loadPendingProjectConfigurationDecision(workspace, decisionFile);
  }

  apply(input: ApplyProjectConfigurationDecisionInput) {
    return applyProjectConfigurationDecision(input);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectOnboarding: ProjectOnboarding;
  }
}
