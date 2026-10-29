import path from 'node:path';

import { bootProjectComposition } from '../../app/boot/bootstrap.js';
import type { ExecutionIsolation } from '../../domains/change-lifecycle/build-protocol.js';
import type { RunStatusView } from '../../domains/runtime/types.js';

const [workspaceArgument, runId, isolationArgument, productRootArgument] = process.argv.slice(2);
if (
  !workspaceArgument ||
  !runId ||
  !productRootArgument ||
  !['current', 'branch', 'worktree'].includes(isolationArgument ?? '')
) {
  throw new Error(
    'Usage: workspace-intent-recovery-driver <workspace> <run-id> <isolation> <product-root>',
  );
}

const workspace = path.resolve(workspaceArgument);
const productRoot = path.resolve(productRootArgument);
const isolation = isolationArgument as ExecutionIsolation;
const application = await bootProjectComposition(productRoot, workspace);

try {
  const before = await application.context.commandRouter.execute<{ runId: string }, RunStatusView>(
    'run.status',
    { runId },
  );
  const wait = before.changeLifecycle?.waitCondition;
  if (wait?.kind !== 'human-decision' || !wait.waitId.startsWith('workspace-intent:')) {
    throw new Error('Run is not waiting for a Workspace intent revision');
  }
  try {
    await application.context.commandRouter.execute('run.change.decide', {
      runId,
      response: {
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'HumanDecisionResponse',
        requestId: wait.requestId,
        proposalHash: wait.proposalDigest,
        decision: 'approve',
      },
      actor: { actorId: 'cross-process-test', source: 'ide', authenticated: true },
      isolation,
    });
    const after = await application.context.commandRouter.execute<{ runId: string }, RunStatusView>(
      'run.status',
      { runId },
    );
    process.stdout.write(
      JSON.stringify({
        ok: true,
        runId: after.state.runId,
        phase: after.changeLifecycle?.phase,
        checkEpoch: after.changeLifecycle?.checkEpoch,
        workId: after.changeLifecycle?.currentWork?.workId ?? null,
        isolation: after.changeLifecycle?.workspaceIntent?.isolation ?? null,
      }),
    );
  } catch (error) {
    const current = await application.context.commandRouter.execute<
      { runId: string },
      RunStatusView
    >('run.status', { runId });
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errorCode:
          error && typeof error === 'object' && 'code' in error ? String(error.code) : null,
        message: error instanceof Error ? error.message : String(error),
        runId: current.state.runId,
        phase: current.changeLifecycle?.phase,
        checkEpoch: current.changeLifecycle?.checkEpoch,
        waitId: current.changeLifecycle?.waitCondition?.waitId ?? null,
      }),
    );
  }
} finally {
  await application.close();
}
