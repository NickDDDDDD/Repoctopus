import type { Context } from '@deepseek-ai/cordis';

import {
  executionCommitPaths,
  inspectExecutionCheckout,
  isExecutionCheckoutClean,
  isExecutionRevisionAncestor,
  observeExecutionCleanupCommit,
  readTrackedExecutionInputs,
} from '../../platform/git/execution-workspace.js';
import {
  ExecutionWorkspaceService,
  type ExecutionCheckoutFacts,
  type ExpectedTaskProjection,
} from '../../services/execution-workspace.js';

export class GitExecutionWorkspaceProvider extends ExecutionWorkspaceService {
  constructor(context: Context) {
    super(context);
  }

  protected inspect(checkoutPath: string): Promise<ExecutionCheckoutFacts> {
    return inspectExecutionCheckout(checkoutPath);
  }

  protected revisionIsAncestor(
    checkoutPath: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return isExecutionRevisionAncestor(checkoutPath, ancestor, descendant);
  }

  readTrackedInputs(checkoutPath: string, head: string): Promise<readonly string[]> {
    return readTrackedExecutionInputs(checkoutPath, head);
  }

  isCheckoutClean(checkoutPath: string): Promise<boolean> {
    return isExecutionCheckoutClean(checkoutPath);
  }

  commitPaths(
    checkoutPath: string,
    previousHead: string,
    head: string,
  ): Promise<readonly string[]> {
    return executionCommitPaths(checkoutPath, previousHead, head);
  }

  observeCleanupCommit(
    checkoutPath: string,
    previousHead: string,
    head: string,
    expectedTasks?: () => Promise<ExpectedTaskProjection | undefined>,
  ): Promise<readonly string[] | null> {
    return observeExecutionCleanupCommit(checkoutPath, previousHead, head, expectedTasks);
  }
}
