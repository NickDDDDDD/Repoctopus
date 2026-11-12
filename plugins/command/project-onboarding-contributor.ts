import type { Context, Plugin } from '@deepseek-ai/cordis';
import type {
  ApplyProjectConfigurationDecisionInput,
  DetectProjectConfigurationInput,
} from '../../services/project-onboarding.js';

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposers = [
      context.commandRouter.register({
        name: 'project.detect',
        execute: ({ input }) =>
          context.projectOnboarding.detect(input as DetectProjectConfigurationInput),
      }),
      context.commandRouter.register({
        name: 'project.init',
        execute: ({ input }) =>
          context.projectOnboarding.init(input as DetectProjectConfigurationInput),
      }),
      context.commandRouter.register({
        name: 'project.prepare',
        execute: ({ input }) =>
          context.projectOnboarding.prepare(
            input as { workspace: string; draftFile: string; completedCandidate: unknown },
          ),
      }),
      context.commandRouter.register({
        name: 'project.decision.load',
        execute: ({ input }) => {
          const request = input as { workspace: string; decisionFile: string };
          return context.projectOnboarding.load(request.workspace, request.decisionFile);
        },
      }),
      context.commandRouter.register({
        name: 'project.decision.apply',
        execute: ({ input }) =>
          context.projectOnboarding.apply(input as ApplyProjectConfigurationDecisionInput),
      }),
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  });
}) as Plugin;

Object.assign(plugin, { inject: ['commandRouter', 'projectOnboarding'] });

export default plugin;
