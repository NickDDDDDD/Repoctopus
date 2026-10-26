import type { Context, Plugin } from '@deepseek-ai/cordis';

import type {
  ChangeBranchReference,
  SpecificationApprovalActor,
  SpecificationApprovalDecisionResponse,
} from '../../domains/specification/types.js';

interface Input {
  changeId?: string;
  approvalPhase?: 'open' | 'design';
  strict?: boolean;
  mergeFactsDigest?: `sha256:${string}`;
  targetBaselineDigest?: `sha256:${string}`;
  plan?: unknown;
  runId?: string;
  changeBranch?: ChangeBranchReference;
  compositionDigest?: `sha256:${string}`;
  projectConfigDigest?: `sha256:${string}`;
  response?: SpecificationApprovalDecisionResponse;
  actor?: SpecificationApprovalActor;
}

const plugin = ((context: Context) => {
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.approval.prepare',
      execute({ input, signal }) {
        const { changeId, changeBranch, compositionDigest, projectConfigDigest } = input as Input;
        if (!changeId?.trim() || !changeBranch || !compositionDigest || !projectConfigDigest) {
          throw new Error('Specification approval preparation requires change and branch facts');
        }
        return context.specificationPlanning.prepare({
          changeId,
          changeBranch,
          compositionDigest,
          projectConfigDigest,
          signal,
        });
      },
    }),
  );
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.approval.status',
      execute({ input }) {
        const { changeId, approvalPhase } = input as Input;
        if (!changeId?.trim()) throw new Error('Specification change id is required');
        return context.specificationPlanning.status(changeId, approvalPhase);
      },
    }),
  );
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.approval.decide',
      execute({ input }) {
        const { changeId, approvalPhase, response, actor } = input as Input;
        if (!changeId?.trim() || !response || !actor) {
          throw new Error('Specification approval decision requires change, response, and actor');
        }
        return context.specificationPlanning.decide({
          changeId,
          ...(approvalPhase ? { approvalPhase } : {}),
          response,
          actor,
        });
      },
    }),
  );
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.inspect',
      execute({ input, signal }) {
        const { changeId } = input as Input;
        if (!changeId?.trim()) throw new Error('Specification change id is required');
        return context.specification.inspect(changeId, signal);
      },
    }),
  );
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.validate',
      async execute({ input, signal }) {
        const { changeId, strict, runId } = input as Input;
        if (!changeId?.trim()) throw new Error('Specification change id is required');
        const validation = await context.specification.validate(changeId, {
          strict: strict !== false,
          signal,
        });
        const workflowRuns = runId ? context.get('workflowRuns') : undefined;
        if (runId && !workflowRuns) {
          throw new Error('Workflow Run capability is required to bind Specification validation');
        }
        const runSnapshot =
          runId && workflowRuns
            ? await workflowRuns.bindSpecification(runId, validation, signal)
            : undefined;
        return { ...validation, ...(runSnapshot ? { runSnapshot } : {}) };
      },
    }),
  );
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.prepare-closure',
      async execute({ input, signal }) {
        const { changeId, mergeFactsDigest, targetBaselineDigest, runId } = input as Input;
        if (!changeId?.trim() || !mergeFactsDigest || !targetBaselineDigest) {
          throw new Error('Closure preparation requires change and both input digests');
        }
        const plan = await context.specification.prepareClosure({
          changeId,
          mergeFactsDigest,
          targetBaselineDigest,
          signal,
        });
        const workflowRuns = runId ? context.get('workflowRuns') : undefined;
        if (runId && !workflowRuns) {
          throw new Error('Workflow Run capability is required to bind a closure plan');
        }
        const runSnapshot =
          runId && workflowRuns
            ? await workflowRuns.bindSpecificationClosurePlan(runId, plan, signal)
            : undefined;
        return { ...plan, ...(runSnapshot ? { runSnapshot } : {}) };
      },
    }),
  );
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.close',
      execute({ input, signal }) {
        const { plan } = input as Input;
        if (!plan || typeof plan !== 'object')
          throw new Error('Specification closure plan is required');
        return context.specification.close(
          plan as Parameters<Context['specification']['close']>[0],
          signal,
        );
      },
    }),
  );
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'specification', 'specificationPlanning'] });

export default plugin;
