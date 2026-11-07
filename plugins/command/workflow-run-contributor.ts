import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { ActionOutcome } from '../../domains/engine/types.js';
import type { WorkClaimRequest } from '../../domains/action/types.js';
import type { ExternalWorkExecutionOutcome } from '../../domains/work-execution/types.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';
import type { WorkflowPackage } from '../../domains/workflow-contract/types.js';
import type {
  DecideChangeRunInput,
  StartChangeRunInput,
  VerifyChangeRunInput,
  PrepareArchiveDeliveryInput,
  ExecuteArchiveDeliveryInput,
} from '../../services/workflow-runs.js';

interface StartInput {
  workflow: WorkflowPackage;
  projectSnapshot: ProjectSnapshot;
  runId?: string;
  workflowSource?: string;
}

interface RecordInput {
  runId: string;
  actionId: string;
  status: ActionOutcome['status'];
  summary: string;
  eventId?: string;
  evidenceAttemptId?: string;
}

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'run.work.claim',
        execute: ({ input }) =>
          context.managedWorkExecutor.claimExternal(input as WorkClaimRequest),
      }),
      context.commandRouter.register({
        name: 'run.work.outcome',
        execute: ({ input }) =>
          context.managedWorkExecutor.acceptExternalOutcome(input as ExternalWorkExecutionOutcome),
      }),
      context.commandRouter.register({
        name: 'run.work.reconcile',
        execute: ({ input }) =>
          context.managedWorkExecutor.reconcile((input as { runId: string }).runId),
      }),
      context.commandRouter.register({
        name: 'run.work.verify',
        execute: ({ input, signal }) =>
          context.workflowRuns.verifyChange(input as VerifyChangeRunInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.archive.prepare',
        execute: ({ input, signal }) =>
          context.workflowRuns.prepareArchiveDelivery(input as PrepareArchiveDeliveryInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.archive.publish',
        execute: ({ input, signal }) =>
          context.workflowRuns.executeArchiveDelivery(input as ExecuteArchiveDeliveryInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.start',
        execute: ({ input, signal }) => context.workflowRuns.start(input as StartInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.change.start',
        execute: ({ input, signal }) =>
          context.workflowRuns.startChange(input as StartChangeRunInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.change.decide',
        execute: ({ input, signal }) =>
          context.workflowRuns.decideChange(input as DecideChangeRunInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.status',
        execute: ({ input, signal }) =>
          context.workflowRuns.status((input as { runId: string }).runId, signal),
      }),
      context.commandRouter.register({
        name: 'run.change.status',
        execute: ({ input, signal }) =>
          context.workflowRuns.changeStatus((input as { runId: string }).runId, signal),
      }),
      context.commandRouter.register({
        name: 'run.next',
        execute: ({ input, signal }) =>
          context.workflowRuns.next((input as { runId: string }).runId, new Set(), signal),
      }),
      context.commandRouter.register({
        name: 'run.record',
        execute: ({ input, signal }) => context.workflowRuns.record(input as RecordInput, signal),
      }),
      context.commandRouter.register({
        name: 'run.resume',
        execute: ({ input, signal }) =>
          context.workflowRuns.resume(
            input as { runId: string; currentProjectSnapshot?: ProjectSnapshot },
            signal,
          ),
      }),
      context.commandRouter.register({
        name: 'run.inspect',
        execute: ({ input }) => context.runStore.inspect((input as { runId: string }).runId),
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, {
  inject: ['commandRouter', 'managedWorkExecutor', 'runStore', 'workflowRuns'],
});

export default plugin;
