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
  decisionRunId?: string;
  buildStrategyDigest?: `sha256:${string}`;
  changeBranch?: ChangeBranchReference;
  response?: SpecificationApprovalDecisionResponse;
  actor?: SpecificationApprovalActor;
}

const plugin = ((context: Context) => {
  context.effect(() =>
    context.commandRouter.register({
      name: 'specification.approval.prepare',
      execute({ input, signal }) {
        const { changeId, changeBranch, decisionRunId, buildStrategyDigest } = input as Input;
        if (!changeId?.trim() || !changeBranch) {
          throw new Error('Specification approval preparation requires change and branch facts');
        }
        return context.specificationPlanning.prepare({
          changeId,
          changeBranch,
          ...(decisionRunId ? { decisionRunId } : {}),
          ...(buildStrategyDigest ? { buildStrategyDigest } : {}),
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
        if (runId) {
          const workflowRuns = context.get('workflowRuns');
          if (!workflowRuns)
            throw new Error('Workflow Run capability is required to check the Change Run');
          await workflowRuns.assertSpecificationChange(runId, changeId);
        }
        return context.specification.validate(changeId, { strict: strict !== false, signal });
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
        if (runId) throw new Error('Use the managed Archive entry point for a Change Run');
        return context.specification.prepareClosure({
          changeId,
          mergeFactsDigest,
          targetBaselineDigest,
          signal,
        });
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
