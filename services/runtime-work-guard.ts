import { Service, type Context } from '@deepseek-ai/cordis';

import {
  authorizeRuntimeWorkOperation,
  observeUnmanagedRuntimeMutation,
  RuntimeWorkAuthorizationError,
  type RuntimeMutationObservation,
  type RuntimeWorkAuthorization,
  type RuntimeWorkOperation,
} from '../domains/change-lifecycle/work-guard.js';

export class RuntimeWorkGuard extends Service {
  static inject = ['actionStore', 'runStore'];

  constructor(context: Context) {
    super(context, 'runtimeWorkGuard');
  }

  async authorize(operation: RuntimeWorkOperation): Promise<RuntimeWorkAuthorization> {
    const claim = operation.claim;
    if (!claim) {
      throw new RuntimeWorkAuthorizationError('Runtime write requires an active Action claim');
    }
    const [state, intent] = await Promise.all([
      this.ctx.runStore.loadRun(claim.runId),
      this.ctx.actionStore.loadLatestIntent(claim.runId, claim.workId),
    ]);
    return authorizeRuntimeWorkOperation({ state, intent, operation });
  }

  observeUnmanagedMutation(input: {
    repositoryId: string;
    path: string;
    reason?: string;
  }): RuntimeMutationObservation {
    return observeUnmanagedRuntimeMutation(input);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    runtimeWorkGuard: RuntimeWorkGuard;
  }
}
