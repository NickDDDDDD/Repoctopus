import { Service, type Context } from '@deepseek-ai/cordis';

import {
  createExecutionWorkspaceBinding,
  type ExecutionWorkspaceBinding,
  type ExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import type { ProjectSnapshot } from '../domains/project/types.js';

export interface ExecutionCheckoutRequest {
  repositoryId: string;
  checkoutPath: string;
}

export interface ExecutionCheckoutFacts {
  checkoutPath: string;
  branch: string;
  head: string;
  remoteIdentity: string | null;
  gitDirectory: string;
  commonDirectory: string;
  worktreeId: string | null;
}

export interface BindExecutionWorkspaceInput {
  intent: ExecutionWorkspaceIntent;
  project: ProjectSnapshot;
  checkouts: readonly ExecutionCheckoutRequest[];
}

export async function bindExecutionWorkspace(
  input: BindExecutionWorkspaceInput,
  inspect: (checkoutPath: string) => Promise<ExecutionCheckoutFacts>,
): Promise<ExecutionWorkspaceBinding> {
  if (input.project.projectId !== input.intent.workspaceId) {
    throw new Error('Execution workspace project does not match the approved intent');
  }
  const expected = [...input.project.repositories].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const requested = [...input.checkouts].sort((left, right) =>
    left.repositoryId.localeCompare(right.repositoryId),
  );
  if (
    requested.length !== expected.length ||
    requested.some((entry, index) => entry.repositoryId !== expected[index]?.id) ||
    new Set(requested.map((entry) => entry.repositoryId)).size !== requested.length
  ) {
    throw new Error('Execution workspace checkout set does not match repository topology');
  }
  const repositories = await Promise.all(
    requested.map(async (request, index) => {
      const projectRepository = expected[index]!;
      const facts = await inspect(request.checkoutPath);
      if (
        projectRepository.remoteIdentity &&
        facts.remoteIdentity !== projectRepository.remoteIdentity
      ) {
        throw new Error(`Execution checkout identity drifted: ${request.repositoryId}`);
      }
      if (input.intent.isolation === 'current') {
        if (facts.checkoutPath.toLowerCase() !== projectRepository.path.toLowerCase()) {
          throw new Error(`Current isolation requires the registered checkout: ${request.repositoryId}`);
        }
        if (facts.worktreeId) {
          throw new Error(`Current isolation cannot bind a linked worktree: ${request.repositoryId}`);
        }
      }
      if (input.intent.isolation === 'branch' && input.intent.targetBranch) {
        if (facts.branch !== input.intent.targetBranch) {
          throw new Error(`Branch isolation does not match the approved branch: ${request.repositoryId}`);
        }
      }
      if (input.intent.isolation === 'worktree' && !facts.worktreeId) {
        throw new Error(`Worktree isolation lacks ownership facts: ${request.repositoryId}`);
      }
      return {
        repositoryId: request.repositoryId,
        checkoutPath: facts.checkoutPath,
        branch: facts.branch,
        head: facts.head,
        worktreeId: facts.worktreeId,
        workspaceOwned: true,
      };
    }),
  );
  return createExecutionWorkspaceBinding({ intent: input.intent, repositories });
}

export abstract class ExecutionWorkspaceService extends Service {
  constructor(context: Context) {
    super(context, 'executionWorkspace');
  }

  protected abstract inspect(checkoutPath: string): Promise<ExecutionCheckoutFacts>;

  async bind(input: BindExecutionWorkspaceInput): Promise<ExecutionWorkspaceBinding> {
    return bindExecutionWorkspace(input, (checkoutPath) => this.inspect(checkoutPath));
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    executionWorkspace: ExecutionWorkspaceService;
  }
}
