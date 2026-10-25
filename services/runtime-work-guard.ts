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
  static inject = ['runStore', 'workExecutionAuthority', 'workExecutionSessions'];

  constructor(context: Context) {
    super(context, 'runtimeWorkGuard');
  }

  async authorize(operation: RuntimeWorkOperation): Promise<RuntimeWorkAuthorization> {
    const session = operation.session;
    if (!session) {
      throw new RuntimeWorkAuthorizationError(
        'Runtime write requires an active Work Execution Session',
      );
    }
    this.ctx.workExecutionSessions.require(session, operation.hostId);
    const [state, intent] = await Promise.all([
      this.ctx.runStore.loadRun(session.runId),
      this.ctx.workExecutionAuthority.loadIntent(session.runId),
    ]);
    const authorization = authorizeRuntimeWorkOperation({ state, intent, operation });
    await this.ctx.workExecutionAuthority.recordToolBoundary({
      runId: authorization.runId,
      intentId: intent.intentId,
      invocationId: authorization.invocationId,
      operationId: authorization.operationId,
      operationKind: authorization.operation,
      stage: 'started',
    });
    return authorization;
  }

  async complete(
    authorization: RuntimeWorkAuthorization,
    result: 'succeeded' | 'failed',
    durationMs: number,
  ): Promise<void> {
    const intent = await this.ctx.workExecutionAuthority.loadIntent(authorization.runId);
    await this.ctx.workExecutionAuthority.recordToolBoundary({
      runId: authorization.runId,
      intentId: intent.intentId,
      invocationId: authorization.invocationId,
      operationId: authorization.operationId,
      operationKind: authorization.operation,
      stage: 'completed',
      result,
      durationMs,
    });
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
