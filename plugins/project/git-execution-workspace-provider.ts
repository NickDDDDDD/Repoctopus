import type { Context } from '@deepseek-ai/cordis';

import {
  inspectExecutionCheckout,
  isExecutionRevisionAncestor,
} from '../../platform/git/execution-workspace.js';
import {
  ExecutionWorkspaceService,
  type ExecutionCheckoutFacts,
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
}
