import type { Context, Plugin } from '@deepseek-ai/cordis';

import type { ProjectProbeInput, WorkspaceSnapshotInput } from '../../services/project.js';

const plugin = ((context: Context) => {
  context.effect(() => {
    const disposeProbe = context.commandRouter.register({
      name: 'project.probe',
      execute: ({ input, signal }) => {
        if (signal.aborted) throw signal.reason;
        return context.project.probe(input as ProjectProbeInput);
      },
    });
    const disposeSnapshot = context.commandRouter.register({
      name: 'workspace.snapshot',
      execute: ({ input, signal }) => {
        if (signal.aborted) throw signal.reason;
        return context.project.snapshot(input as WorkspaceSnapshotInput);
      },
    });
    return () => {
      disposeSnapshot();
      disposeProbe();
    };
  });
}) as Plugin;

Object.assign(plugin, {
  inject: ['commandRouter', 'project'],
});

export default plugin;
