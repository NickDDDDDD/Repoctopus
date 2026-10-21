import type { Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../../domains/project/types.js';
import { probeProject, snapshotWorkspaceRepositories } from '../../platform/git/probe.js';
import {
  ProjectService,
  type ProjectProbeInput,
  type WorkspaceSnapshotInput,
} from '../../services/project.js';

export class GitProjectProvider extends ProjectService {
  constructor(context: Context) {
    super(context);
  }

  async probe(input: ProjectProbeInput): Promise<ProjectSnapshot> {
    return probeProject(input);
  }

  async snapshot(input: WorkspaceSnapshotInput): Promise<ProjectSnapshot> {
    return snapshotWorkspaceRepositories(input);
  }
}
