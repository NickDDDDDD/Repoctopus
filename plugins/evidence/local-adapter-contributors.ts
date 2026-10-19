import type { Context, Plugin } from '@deepseek-ai/cordis';

import { LocalBrowserAdapter } from '../../platform/browser/browser-adapter.js';
import { LocalCommandAdapter } from '../../platform/feedback/command-adapter.js';
import { FileExchangeVisualInspectionAdapter } from '../../platform/feedback/file-exchange-visual-adapter.js';
import { LocalServiceAdapter } from '../../platform/feedback/service-adapter.js';

export interface LocalEvidenceAdapterConfig {
  workspaceRoot: string;
}

function contributor(
  kind: 'command' | 'service' | 'browser' | 'visual',
  factory: Parameters<Context['evidenceAdapters']['register']>[1],
): Plugin {
  return Object.assign(
    (context: Context) => {
      context.effect(() => context.evidenceAdapters.register(kind, factory));
    },
    { inject: ['evidenceAdapters'] },
  ) as Plugin;
}

export const localCommandContributor = contributor('command', () => new LocalCommandAdapter());

export const localServiceContributor = ((context: Context, config: LocalEvidenceAdapterConfig) => {
  context.effect(() =>
    context.evidenceAdapters.register(
      'service',
      () => new LocalServiceAdapter(config.workspaceRoot),
    ),
  );
}) as Plugin;
Object.assign(localServiceContributor, { inject: ['evidenceAdapters'] });

export const localBrowserContributor = ((context: Context, config: LocalEvidenceAdapterConfig) => {
  context.effect(() =>
    context.evidenceAdapters.register(
      'browser',
      (project, artifacts) =>
        new LocalBrowserAdapter(config.workspaceRoot, artifacts, {
          ...(project.local?.browser?.executablePath
            ? { configuredExecutablePath: project.local.browser.executablePath }
            : {}),
        }),
    ),
  );
}) as Plugin;
Object.assign(localBrowserContributor, { inject: ['evidenceAdapters'] });

export const fileVisualContributor = ((context: Context, config: LocalEvidenceAdapterConfig) => {
  context.effect(() =>
    context.evidenceAdapters.register('visual', (project) =>
      project.local?.visual
        ? new FileExchangeVisualInspectionAdapter(config.workspaceRoot, project.local.visual)
        : undefined,
    ),
  );
}) as Plugin;
Object.assign(fileVisualContributor, { inject: ['evidenceAdapters'] });
