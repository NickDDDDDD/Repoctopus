import { bootApp, type RunningApp } from './boot.js';
import { compileComposition } from './composition.js';
import { createRepoctopusBuiltinCatalog } from '../../plugins/builtin-catalog.js';
import { loadProjectConfig } from '../../platform/project-configuration/file-config.js';
import { mergePluginCatalogs } from './descriptor.js';
import { admitTeamPlugins, importTeamPlugins } from './team-plugins.js';
import { lifecycleTelemetryFromEnvironment } from '../../platform/telemetry/opentelemetry/exporter.js';

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

export async function bootProjectComposition(
  productRoot: string,
  workspaceRoot: string,
): Promise<RunningApp> {
  const config = await loadProjectConfig(workspaceRoot);
  const builtinCatalog = await createRepoctopusBuiltinCatalog(productRoot);
  const admitted = await admitTeamPlugins(workspaceRoot, config.shared.composition?.plugins ?? []);
  const catalog = mergePluginCatalogs(builtinCatalog, await importTeamPlugins(admitted));
  const composition = compileComposition(
    {
      id: 'repoctopus-project',
      kind: 'project',
      configuration: {
        sharedDigest: config.sharedDigest,
        localDigest: config.localDigest,
        effectiveDigest: config.effectiveDigest,
      },
      plugins: [
        { id: 'command-router' },
        { id: 'skill-registry' },
        { id: 'skill-provider-matt', config: { productRoot } },
        { id: 'skill-provider-filesystem', config: { workspaceRoot } },
        { id: 'skill-command' },
        { id: 'specification-openspec', config: { workspaceRoot } },
        { id: 'specification-command' },
        { id: 'project-git' },
        { id: 'project-probe-command' },
        { id: 'project-onboarding' },
        { id: 'project-onboarding-command' },
        { id: 'browser-maintenance' },
        { id: 'maintenance-command', config: { productRoot } },
        { id: 'platform-events-file', config: { workspaceRoot } },
        { id: 'platform-event-command' },
        { id: 'action-store-file', config: { workspaceRoot } },
        { id: 'action-dispatcher' },
        { id: 'action-manual' },
        { id: 'run-store-file', config: { workspaceRoot } },
        { id: 'workflow-source-file' },
        { id: 'workflow-telemetry-otel' },
        { id: 'evidence-adapters' },
        { id: 'evidence-command-local' },
        { id: 'evidence-service-local', config: { workspaceRoot } },
        { id: 'evidence-browser-local', config: { workspaceRoot } },
        { id: 'evidence-visual-file', config: { workspaceRoot } },
        { id: 'evidence-coordinator', config: { workspaceRoot } },
        { id: 'evidence-command' },
        { id: 'delivery-file', config: { workspaceRoot } },
        { id: 'delivery-command' },
        { id: 'workflow-runs', config: { workspaceRoot } },
        { id: 'workflow-run-command' },
        ...(config.shared.composition?.plugins.map((plugin) => ({
          id: plugin.id,
          ...(plugin.config === undefined ? {} : { config: plugin.config }),
        })) ?? []),
      ],
      requiredServices: [
        'actionDispatcher',
        'actionStore',
        'browserMaintenance',
        'commandRouter',
        'delivery',
        'evidenceAdapters',
        'evidenceCoordinator',
        'project',
        'projectOnboarding',
        'platformEvents',
        'runStore',
        'skills',
        'specification',
        'workflowRuns',
        'workflowSource',
        'workflowTelemetry',
      ],
    },
    catalog,
  );
  return bootApp({ composition, catalog, lifecycleTelemetry: lifecycleTelemetryFromEnvironment() });
}
