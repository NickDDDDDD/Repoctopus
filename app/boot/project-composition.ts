import path from 'node:path';

import type {
  EffectiveProjectConfig,
  TeamPluginConfig,
} from '../../domains/project-configuration/types.js';
import type { DeliveryPolicy } from '../../domains/delivery/types.js';
import type { BuiltinPluginRegistration } from './descriptor.js';
import {
  compileComposition,
  type CompiledComposition,
  type CompositionPluginSelection,
} from './composition.js';

const DEFAULT_SKILL_PROVIDERS = [
  { id: 'skill-provider-matt' },
  { id: 'skill-provider-filesystem' },
] as const;
const DEFAULT_SPECIFICATION_PROVIDER = { id: 'specification-openspec' } as const;
const DEFAULT_PLATFORM_EVENTS_PROVIDER = { id: 'platform-events-file' } as const;

function configuredSelection(
  id: string,
  builtinConfig: Readonly<Record<string, unknown>>,
  teamPlugins: ReadonlyMap<string, TeamPluginConfig>,
): CompositionPluginSelection {
  const team = teamPlugins.get(id);
  const config = team?.config ?? builtinConfig[id];
  return { id, ...(config === undefined ? {} : { config }) };
}

function deliveryPolicy(config: EffectiveProjectConfig): DeliveryPolicy {
  if (!config.shared.delivery) {
    throw new Error('Post-merge Runner requires a shared Delivery policy');
  }
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'DeliveryPolicy',
    ...structuredClone(config.shared.delivery),
  };
}

function projectSelections(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
): CompositionPluginSelection[] {
  const teamPlugins = new Map(
    (config.shared.composition?.plugins ?? []).map((plugin) => [plugin.id, plugin] as const),
  );
  const builtinConfig: Readonly<Record<string, unknown>> = {
    'skill-provider-matt': { productRoot },
    'skill-provider-filesystem': { workspaceRoot },
    'specification-openspec': { workspaceRoot },
    'platform-events-file': { workspaceRoot },
  };
  const skillProviders = config.shared.skillProviders ?? DEFAULT_SKILL_PROVIDERS;
  const specificationProvider =
    config.shared.specificationProvider ?? DEFAULT_SPECIFICATION_PROVIDER;
  const platformEventsProvider =
    config.shared.platformEvents?.storeProvider ?? DEFAULT_PLATFORM_EVENTS_PROVIDER;
  const selectedProviders = [
    ...skillProviders.map((provider) =>
      configuredSelection(provider.id, builtinConfig, teamPlugins),
    ),
    configuredSelection(specificationProvider.id, builtinConfig, teamPlugins),
    configuredSelection(platformEventsProvider.id, builtinConfig, teamPlugins),
  ];
  const selectedIds = new Set(selectedProviders.map((selection) => selection.id));

  return [
    { id: 'command-router' },
    { id: 'skill-registry' },
    ...selectedProviders,
    { id: 'skill-command' },
    { id: 'specification-command' },
    { id: 'project-git' },
    { id: 'project-probe-command' },
    { id: 'project-onboarding' },
    { id: 'project-onboarding-command' },
    { id: 'browser-maintenance' },
    { id: 'maintenance-command', config: { productRoot } },
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
    {
      id: 'delivery-file',
      config: {
        workspaceRoot,
        ...(config.shared.platformEvents
          ? { githubTokenVariable: config.shared.platformEvents.github.apiCredential.variable }
          : {}),
      },
    },
    { id: 'delivery-command' },
    { id: 'workflow-runs', config: { workspaceRoot } },
    { id: 'workflow-run-command' },
    ...(config.shared.composition?.plugins
      .filter((plugin) => !selectedIds.has(plugin.id))
      .map((plugin) => ({
        id: plugin.id,
        ...(plugin.config === undefined ? {} : { config: plugin.config }),
      })) ?? []),
  ];
}

function runnerSelections(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
): CompositionPluginSelection[] {
  const platformEvents = config.shared.platformEvents;
  if (!platformEvents) {
    throw new Error('Runner application requires platformEvents configuration');
  }
  const postMerge = config.shared.postMerge;
  return [
    ...projectSelections(productRoot, workspaceRoot, config),
    {
      id: 'http-host',
      config: {
        hostname: platformEvents.http.hostname,
        port: platformEvents.http.port,
        shutdownTimeoutMs: platformEvents.http.shutdownTimeoutMs,
      },
    },
    {
      id: 'github-webhook-route',
      config: {
        source: platformEvents.github.source,
        path: platformEvents.github.path,
        maxBodyBytes: platformEvents.github.maxBodyBytes,
        credentialVariable: platformEvents.github.webhookCredential.variable,
      },
    },
    {
      id: 'platform-event-runner',
      config: {
        owner: platformEvents.runner.identity,
        leaseMs: platformEvents.runner.leaseMs,
        pollIntervalMs: platformEvents.runner.pollIntervalMs,
        retryDelayMs: platformEvents.runner.retryDelayMs,
        maxAttempts: platformEvents.runner.maxAttempts,
        shutdownTimeoutMs: platformEvents.runner.shutdownTimeoutMs,
      },
    },
    ...(postMerge
      ? [
          { id: 'post-merge-coordinator', config: { policy: deliveryPolicy(config) } },
          { id: 'github-post-merge-events' },
          {
            id: 'post-merge-actions',
            config: {
              workspaceRoot,
              temporaryRoot: path.resolve(workspaceRoot, postMerge.temporaryRoot),
              verificationPathPrefixes: postMerge.allowedWorkspacePaths.verificationPathPrefixes,
              publication: postMerge.publication,
            },
          },
        ]
      : []),
    { id: 'runner-application' },
  ];
}

const BASE_REQUIRED_SERVICES = [
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
] as const;

function compile(
  id: string,
  selections: CompositionPluginSelection[],
  requiredServices: readonly string[],
  config: EffectiveProjectConfig,
  catalog: ReadonlyMap<string, BuiltinPluginRegistration>,
): CompiledComposition {
  return compileComposition(
    {
      id,
      kind: 'project',
      configuration: {
        sharedDigest: config.sharedDigest,
        localDigest: config.localDigest,
        effectiveDigest: config.effectiveDigest,
      },
      plugins: selections,
      requiredServices,
    },
    catalog,
  );
}

export function compileProjectComposition(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
  catalog: ReadonlyMap<string, BuiltinPluginRegistration>,
): CompiledComposition {
  return compile(
    'repoctopus-project',
    projectSelections(productRoot, workspaceRoot, config),
    BASE_REQUIRED_SERVICES,
    config,
    catalog,
  );
}

export function compileRunnerComposition(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
  catalog: ReadonlyMap<string, BuiltinPluginRegistration>,
): CompiledComposition {
  return compile(
    'repoctopus-runner',
    runnerSelections(productRoot, workspaceRoot, config),
    [
      ...BASE_REQUIRED_SERVICES,
      'httpHost',
      'platformEventRunner',
      ...(config.shared.postMerge ? ['postMergeActions', 'postMergeCoordinator'] : []),
    ],
    config,
    catalog,
  );
}
