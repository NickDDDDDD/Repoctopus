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
  constructor(context: Context) {
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

  configureVerify(input: { workspace: string; profile: unknown }) {
    return prepareVerifyProfileDecision(input);
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
