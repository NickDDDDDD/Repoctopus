import type { Context } from '@deepseek-ai/cordis';

import { inspectExecutionCheckout } from '../../platform/git/execution-workspace.js';
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
}
