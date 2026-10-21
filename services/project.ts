import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../domains/project/types.js';

export interface ProjectProbeInput {
  root: string;
  duplicateIdentity?: 'error' | 'omit-ambiguous';
  now?: () => Date;
}

export interface WorkspaceSnapshotInput {
  workspaceId: string;
  workspaceRoot: string;
  workspaceRepositoryId: string;
  repositories: Array<{ id: string; path: string }>;
  now?: () => Date;
}

export abstract class ProjectService extends Service {
  constructor(context: Context) {
    super(context, 'project');
  }

  abstract probe(input: ProjectProbeInput): Promise<ProjectSnapshot>;
  abstract snapshot(input: WorkspaceSnapshotInput): Promise<ProjectSnapshot>;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    project: ProjectService;
  }
}
