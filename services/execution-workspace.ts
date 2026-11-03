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

export type ExecutionWorkspaceBindingErrorCode =
  | 'workspace-identity-mismatch'
  | 'repository-topology-drift'
  | 'remote-identity-drift'
  | 'current-checkout-mismatch'
  | 'current-linked-worktree'
  | 'branch-mismatch'
  | 'worktree-ownership-missing';

export type ExecutionWorkspaceBindingRecovery = 'intent-revision' | 'binding-retry' | 'halt';

export class ExecutionWorkspaceBindingError extends Error {
  override readonly name = 'ExecutionWorkspaceBindingError';

  constructor(
    message: string,
    readonly code: ExecutionWorkspaceBindingErrorCode,
    readonly recovery: ExecutionWorkspaceBindingRecovery,
  ) {
    super(message);
  }
}

export async function bindExecutionWorkspace(
  input: BindExecutionWorkspaceInput,
  inspect: (checkoutPath: string) => Promise<ExecutionCheckoutFacts>,
): Promise<ExecutionWorkspaceBinding> {
  if (input.project.projectId !== input.intent.workspaceId) {
    throw new ExecutionWorkspaceBindingError(
      'Execution workspace project does not match the approved intent',
      'workspace-identity-mismatch',
      'halt',
    );
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
    throw new ExecutionWorkspaceBindingError(
      'Execution workspace checkout set does not match repository topology',
      'repository-topology-drift',
      'halt',
    );
  }
  const repositories = await Promise.all(
    requested.map(async (request, index) => {
      const projectRepository = expected[index]!;
      const facts = await inspect(request.checkoutPath);
      if (
        projectRepository.remoteIdentity &&
        facts.remoteIdentity !== projectRepository.remoteIdentity
      ) {
        throw new ExecutionWorkspaceBindingError(
          `Execution checkout identity drifted: ${request.repositoryId}`,
          'remote-identity-drift',
          'halt',
        );
      }
      if (input.intent.isolation === 'current') {
        if (facts.checkoutPath.toLowerCase() !== projectRepository.path.toLowerCase()) {
          throw new ExecutionWorkspaceBindingError(
            `Current isolation requires the registered checkout: ${request.repositoryId}`,
            'current-checkout-mismatch',
            'binding-retry',
          );
        }
        if (facts.worktreeId) {
          throw new ExecutionWorkspaceBindingError(
            `Current isolation cannot bind a linked worktree: ${request.repositoryId}`,
            'current-linked-worktree',
            'intent-revision',
          );
        }
      }
      if (input.intent.isolation === 'branch' && input.intent.targetBranch) {
        if (facts.branch !== input.intent.targetBranch) {
          throw new ExecutionWorkspaceBindingError(
            `Branch isolation does not match the approved branch: ${request.repositoryId}`,
            'branch-mismatch',
            'binding-retry',
          );
        }
      }
      if (input.intent.isolation === 'worktree' && !facts.worktreeId) {
        throw new ExecutionWorkspaceBindingError(
          `Worktree isolation lacks ownership facts: ${request.repositoryId}`,
          'worktree-ownership-missing',
          'binding-retry',
        );
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
  protected abstract revisionIsAncestor(
    checkoutPath: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean>;

  async bind(input: BindExecutionWorkspaceInput): Promise<ExecutionWorkspaceBinding> {
    return bindExecutionWorkspace(input, (checkoutPath) => this.inspect(checkoutPath));
  }

  async isAncestor(checkoutPath: string, ancestor: string, descendant: string): Promise<boolean> {
    return this.revisionIsAncestor(checkoutPath, ancestor, descendant);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    executionWorkspace: ExecutionWorkspaceService;
  }
}
