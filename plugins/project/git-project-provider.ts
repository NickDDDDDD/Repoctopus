import type { Context } from '@deepseek-ai/cordis';

import type { ProjectSnapshot } from '../../domains/project/types.js';
import { probeProject } from '../../platform/git/probe.js';
import { ProjectService, type ProjectProbeInput } from '../../services/project.js';

export class GitProjectProvider extends ProjectService {
  constructor(context: Context) {
    super(context);
  }

  async probe(input: ProjectProbeInput): Promise<ProjectSnapshot> {
    return probeProject(input);
  }
}
