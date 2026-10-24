import type { Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot, TargetBranchSnapshot } from '../../domains/project/types.js';
import type { ChangeBranchReference } from '../../domains/specification/types.js';
import {
  inspectCurrentPublishedChangeBranch,
  inspectRemoteTargetBranch,
} from '../../platform/git/change-branch.js';
import { probeProject, snapshotWorkspaceRepositories } from '../../platform/git/probe.js';
import {
  ProjectService,
  type ProjectProbeInput,
  type TargetBranchInput,
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

  async targetBranch(input: TargetBranchInput): Promise<TargetBranchSnapshot> {
    return inspectRemoteTargetBranch(input);
  }

  async changeBranch(input: TargetBranchInput): Promise<ChangeBranchReference> {
    return inspectCurrentPublishedChangeBranch(input);
  }
}
