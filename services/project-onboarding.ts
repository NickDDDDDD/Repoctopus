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
} from '../platform/project-configuration/onboarding.js';
import { detectProjectConfiguration } from '../platform/project-configuration/detect.js';

export interface ApplyProjectConfigurationDecisionInput {
  workspace: string;
  decisionFile: string;
  response: ProjectConfigurationDecisionResponse;
  actor: ProjectConfigurationDecisionActor;
  timestamp: string;
}

export class ProjectOnboarding extends Service {
  constructor(context: Context) {
    super(context, 'projectOnboarding');
  }

  detect(input: { workspace: string; scopeRoot: string }) {
    return detectProjectConfiguration(input);
  }

  prepare(input: { workspace: string; draftFile: string; completedCandidate: unknown }) {
    return prepareProjectConfigurationDecision(input);
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
