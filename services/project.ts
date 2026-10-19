import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../domains/project/types.js';

export interface ProjectProbeInput {
  root: string;
  workspaceRoot?: string;
  duplicateIdentity?: 'error' | 'omit-ambiguous';
  now?: () => Date;
}

export abstract class ProjectService extends Service {
  constructor(context: Context) {
    super(context, 'project');
  }

  abstract probe(input: ProjectProbeInput): Promise<ProjectSnapshot>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    project: ProjectService;
  }
}
