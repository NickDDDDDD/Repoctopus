import path from 'node:path';

import type {
  EffectiveProjectConfig,
  TeamPluginConfig,
} from '../../domains/project-configuration/types.js';
import type { DeliveryPolicy } from '../../domains/delivery/types.js';
import type { SpecificationRoot } from '../../services/specification.js';
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
const DEFAULT_SPECIFICATION_PROVIDER_ID = 'specification-openspec';
const DEFAULT_PLATFORM_EVENTS_PROVIDER = { id: 'platform-events-file' } as const;
const PRODUCT_ROOT_IDENTITY = '@repoctopus/product-root';
const WORKSPACE_ROOT_IDENTITY = '@repoctopus/workspace-root';

interface BuiltinRuntimeConfig {
  config: unknown;
  identityConfig: unknown;
}

function runtimeSelection(
  id: string,
  config: unknown,
  identityConfig: unknown,
): CompositionPluginSelection {
  return { id, config, identityConfig };
}

function configuredSelection(
  id: string,
  builtinConfig: Readonly<Record<string, BuiltinRuntimeConfig>>,
  teamPlugins: ReadonlyMap<string, TeamPluginConfig>,
): CompositionPluginSelection {
  const team = teamPlugins.get(id);
  if (team?.config !== undefined) return { id, config: team.config };
  const builtin = builtinConfig[id];
  return builtin ? runtimeSelection(id, builtin.config, builtin.identityConfig) : { id };
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
  const specificationProvider = config.shared.specificationProvider ?? {
    id: DEFAULT_SPECIFICATION_PROVIDER_ID,
    store: {
      id: config.shared.workspace.id,
      repositoryId: config.shared.workspace.repositoryId,
    },
  };
  const specificationRepository = config.repositories.find(
    (repository) => repository.id === specificationProvider.store.repositoryId,
  );
  if (!specificationRepository) {
    throw new Error(
      `Specification Store repository is not resolved: ${specificationProvider.store.repositoryId}`,
    );
  }
  const specificationRoot: SpecificationRoot = {
    schemaVersion: 1,
    kind: 'SpecificationRoot',
    storeId: specificationProvider.store.id,
    repositoryId: specificationProvider.store.repositoryId,
  };
  const builtinConfig: Readonly<Record<string, BuiltinRuntimeConfig>> = {
    'skill-provider-matt': {
      config: { productRoot },
      identityConfig: { productRoot: PRODUCT_ROOT_IDENTITY },
    },
    'skill-provider-filesystem': {
      config: { workspaceRoot },
      identityConfig: { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    },
    'specification-openspec': {
      config: { workspaceRoot: specificationRepository.resolvedPath, specificationRoot },
      identityConfig: { workspaceRoot: WORKSPACE_ROOT_IDENTITY, specificationRoot },
    },
    'platform-events-file': {
      config: { workspaceRoot },
      identityConfig: { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    },
  };
  const skillProviders = config.shared.skillProviders ?? DEFAULT_SKILL_PROVIDERS;
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
    runtimeSelection(
      'skill-provider-consistency-method',
      { productRoot },
      { productRoot: PRODUCT_ROOT_IDENTITY },
    ),
    { id: 'skill-command' },
    runtimeSelection(
      'specification-planning',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'specification-command' },
    { id: 'project-git' },
    { id: 'project-probe-command' },
    { id: 'project-onboarding' },
    { id: 'project-onboarding-command' },
    { id: 'browser-maintenance' },
    runtimeSelection(
      'maintenance-command',
      { productRoot },
      { productRoot: PRODUCT_ROOT_IDENTITY },
    ),
    { id: 'platform-event-command' },
    runtimeSelection(
      'action-store-file',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'action-dispatcher' },
    runtimeSelection(
      'run-store-file',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'runtime-work-guard' },
    runtimeSelection(
      'work-context-assembler',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'work-dispatcher' },
    { id: 'lifecycle-definition-service' },
    { id: 'lifecycle-definition-builtin' },
    { id: 'lifecycle-validator-service' },
    { id: 'lifecycle-validator-builtin' },
    { id: 'lifecycle-extension-service' },
    { id: 'lifecycle-extension-builtin' },
    { id: 'action-manual' },
    { id: 'action-work-contributors' },
    { id: 'workflow-source-file' },
    { id: 'workflow-telemetry-otel' },
    { id: 'evidence-adapters' },
    { id: 'evidence-command-local' },
    runtimeSelection(
      'evidence-service-local',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    runtimeSelection(
      'evidence-browser-local',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    runtimeSelection(
      'evidence-visual-file',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    runtimeSelection(
      'evidence-coordinator',
      {
        workspaceRoot,
        ...(config.shared.postMerge
          ? { postMergeEvidenceProfile: config.shared.postMerge.evidenceProfile }
          : {}),
      },
      {
        workspaceRoot: WORKSPACE_ROOT_IDENTITY,
        ...(config.shared.postMerge
          ? { postMergeEvidenceProfile: config.shared.postMerge.evidenceProfile }
          : {}),
      },
    ),
    { id: 'evidence-command' },
    runtimeSelection(
      'delivery-file',
      {
        workspaceRoot,
        projectConfigDigest: `sha256:${config.effectiveDigest}`,
        ...(config.shared.platformEvents
          ? { githubTokenVariable: config.shared.platformEvents.github.apiCredential.variable }
          : {}),
      },
      {
        workspaceRoot: WORKSPACE_ROOT_IDENTITY,
        projectConfigDigest: `sha256:${config.effectiveDigest}`,
        ...(config.shared.platformEvents
          ? { githubTokenVariable: config.shared.platformEvents.github.apiCredential.variable }
          : {}),
      },
    ),
    { id: 'delivery-command' },
    runtimeSelection(
      'consistency-reconciler',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'consistency-command' },
    runtimeSelection(
      'consistency-review',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    runtimeSelection(
      'workflow-runs',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    runtimeSelection(
      'change-lifecycle-migration',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'change-lifecycle-migration-command' },
    { id: 'workflow-run-command' },
    ...postMergeSelections(productRoot, workspaceRoot, config),
    ...(config.shared.composition?.plugins
      .filter((plugin) => !selectedIds.has(plugin.id))
      .map((plugin) => ({
        id: plugin.id,
        ...(plugin.config === undefined ? {} : { config: plugin.config }),
      })) ?? []),
  ];
}

function postMergeSelections(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
): CompositionPluginSelection[] {
  const postMerge = config.shared.postMerge;
  if (!postMerge) return [];
  return [
    runtimeSelection(
      'post-merge-coordinator',
      {
        policy: deliveryPolicy(config),
        execution: {
          projectId: config.shared.workspace.id,
          workspaceRoot,
          workflowSource: path.join(productRoot, 'workflows', 'post-merge.yaml'),
          evidenceProfile: postMerge.evidenceProfile,
          repositories: config.shared.repositories.map((repository) => ({
            repositoryId: repository.id,
            path: path.resolve(workspaceRoot, repository.path),
          })),
        },
      },
      {
        policy: deliveryPolicy(config),
        execution: {
          projectId: config.shared.workspace.id,
          workspaceRoot: WORKSPACE_ROOT_IDENTITY,
          workflowSource: `${PRODUCT_ROOT_IDENTITY}/workflows/post-merge.yaml`,
          evidenceProfile: postMerge.evidenceProfile,
          repositories: config.shared.repositories.map((repository) => ({
            repositoryId: repository.id,
            path: `${WORKSPACE_ROOT_IDENTITY}/${repository.path.replaceAll('\\', '/')}`,
          })),
        },
      },
    ),
    runtimeSelection(
      'post-merge-actions',
      {
        workspaceRoot,
        temporaryRoot: path.resolve(workspaceRoot, postMerge.temporaryRoot),
        verificationPathPrefixes: postMerge.allowedWorkspacePaths.verificationPathPrefixes,
        publication: postMerge.publication,
      },
      {
        workspaceRoot: WORKSPACE_ROOT_IDENTITY,
        temporaryRoot: `${WORKSPACE_ROOT_IDENTITY}/${postMerge.temporaryRoot.replaceAll('\\', '/')}`,
        verificationPathPrefixes: postMerge.allowedWorkspacePaths.verificationPathPrefixes,
        publication: postMerge.publication,
      },
    ),
    { id: 'archive-command' },
    { id: 'post-merge-command' },
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
    ...(config.shared.postMerge ? [{ id: 'github-post-merge-events' }] : []),
    { id: 'runner-application' },
  ];
}

const BASE_REQUIRED_SERVICES = [
  'actionDispatcher',
  'actionStore',
  'browserMaintenance',
  'changeLifecycleMigration',
  'consistencyReconciler',
  'consistencyReview',
  'commandRouter',
  'delivery',
  'evidenceAdapters',
  'evidenceCoordinator',
  'lifecycleDefinitions',
  'lifecycleExtensions',
  'lifecycleValidators',
  'project',
  'projectOnboarding',
  'platformEvents',
  'runStore',
  'runtimeWorkGuard',
  'skills',
  'specification',
  'specificationPlanning',
  'workflowRuns',
  'workDispatcher',
  'workContextAssembler',
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
