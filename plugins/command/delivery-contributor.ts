import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { DeliveryPreparation } from '../../services/delivery.js';
import type {
  DeliveryIntent,
  DeliveryPolicy,
  HumanDecisionResponse,
  TrustedActor,
} from '../../domains/delivery/types.js';
import type { ProjectSnapshot } from '../../domains/project/types.js';

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'delivery.checkpoint',
        execute: ({ input, signal }) => {
          const request = input as {
            project: ProjectSnapshot;
            intent: DeliveryIntent;
            policy: DeliveryPolicy;
          };
          return context.delivery.checkpoint(
            request.project,
            request.intent,
            request.policy,
            signal,
          );
        },
      }),
      context.commandRouter.register({
        name: 'delivery.prepare',
        execute: ({ input, signal }) =>
          context.delivery.prepare(input as DeliveryPreparation, signal),
      }),
      context.commandRouter.register({
        name: 'delivery.status',
        execute: ({ input, signal }) =>
          context.delivery.status((input as { changeId: string }).changeId, signal),
      }),
      context.commandRouter.register({
        name: 'delivery.decide',
        execute: ({ input, signal }) => {
          const request = input as {
            changeId: string;
            response: HumanDecisionResponse;
            actor: TrustedActor;
          };
          return context.delivery.decide(request.changeId, request.response, request.actor, signal);
        },
      }),
      context.commandRouter.register({
        name: 'delivery.publish',
        execute: ({ input, signal }) =>
          context.delivery.publish(input as DeliveryPreparation, signal),
      }),
      context.commandRouter.register({
        name: 'delivery.refresh',
        execute: ({ input, signal }) => {
          const request = input as { changeId: string; policy: DeliveryPolicy };
          return context.delivery.refresh(request.changeId, request.policy, signal);
        },
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'delivery'] });

export default plugin;
