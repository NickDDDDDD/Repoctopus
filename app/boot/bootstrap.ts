import { bootApp, type RunningApp } from './boot.js';
import { compileComposition } from './composition.js';
import { createRepoctopusBuiltinCatalog } from '../../plugins/builtin-catalog.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { mergePluginCatalogs } from './descriptor.js';
import { admitTeamPlugins, importTeamPlugins } from './team-plugins.js';
import { lifecycleTelemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/exporter.js';
import { compileProjectComposition } from './project-composition.js';

export async function bootBootstrapComposition(productRoot: string): Promise<RunningApp> {
  const catalog = await createRepoctopusBuiltinCatalog(productRoot);
  const composition = compileComposition(
    {
      id: 'repoctopus-bootstrap',
      kind: 'bootstrap',
      plugins: [
        { id: 'command-router' },
        { id: 'project-git' },
        { id: 'project-probe-command' },
        { id: 'project-onboarding' },
        { id: 'project-onboarding-command' },
        { id: 'browser-maintenance' },
        { id: 'maintenance-command', config: { productRoot } },
      ],
      requiredServices: ['browserMaintenance', 'commandRouter', 'project', 'projectOnboarding'],
    },
    catalog,
  );
  return bootApp({ composition, catalog, lifecycleTelemetry: lifecycleTelemetryFromEnvironment() });
}

export async function bootDesktopComposition(productRoot: string): Promise<RunningApp> {
  const catalog = await createRepoctopusBuiltinCatalog(productRoot);
  const composition = compileComposition(
    {
      id: 'repoctopus-desktop',
      kind: 'desktop',
      plugins: [{ id: 'desktop-application-service' }, { id: 'desktop-application' }],
      requiredServices: ['desktopApplication'],
    },
    catalog,
  );
  return bootApp({ composition, catalog, lifecycleTelemetry: lifecycleTelemetryFromEnvironment() });
}

export async function bootProjectComposition(
  productRoot: string,
  workspaceRoot: string,
): Promise<RunningApp> {
  const config = await loadProjectConfig(workspaceRoot);
  const builtinCatalog = await createRepoctopusBuiltinCatalog(productRoot);
  const admitted = await admitTeamPlugins(workspaceRoot, config.shared.composition?.plugins ?? []);
  const catalog = mergePluginCatalogs(builtinCatalog, await importTeamPlugins(admitted));
  const composition = compileProjectComposition(productRoot, workspaceRoot, config, catalog);
  return bootApp({ composition, catalog, lifecycleTelemetry: lifecycleTelemetryFromEnvironment() });
}
