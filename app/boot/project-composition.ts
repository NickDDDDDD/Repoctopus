import { projectExecutionConfigDigests } from '../../platform/project-configuration/file-config.js';
import type {
  EffectiveProjectConfig,
  TeamPluginConfig,
} from '../../domains/project-configuration/types.js';
import type { SpecificationRoot } from '../../services/specification.js';
import type { BuiltinPluginRegistration } from './descriptor.js';
import {
  compileComposition,
  type CompiledComposition,
  type CompositionPluginSelection,
} from './composition.js';

const DEFAULT_SKILL_PROVIDERS = [
  { id: 'skill-provider-lifecycle' },
  { id: 'skill-provider-matt' },
  { id: 'skill-provider-filesystem' },
] as const;
const DEFAULT_SPECIFICATION_PROVIDER_ID = 'specification-openspec';
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

function skillProviderSelections(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
  teamPlugins: ReadonlyMap<string, TeamPluginConfig>,
): CompositionPluginSelection[] {
  const productConfig = {
    config: { productRoot },
    identityConfig: { productRoot: PRODUCT_ROOT_IDENTITY },
  };
  const builtinConfig = {
    'skill-provider-matt': productConfig,
    'skill-provider-lifecycle': productConfig,
    'skill-provider-filesystem': {
      config: { workspaceRoot },
      identityConfig: { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    },
  };
  return (config.shared.skillProviders ?? DEFAULT_SKILL_PROVIDERS).map(({ id }) =>
    configuredSelection(id, builtinConfig, teamPlugins),
  );
}

function teamSkillSelection(
  workspaceRoot: string,
  config: EffectiveProjectConfig,
): CompositionPluginSelection {
  const bindings = config.shared.lifecycle?.skillBindings.bindings ?? [];
  return runtimeSelection(
    'team-skill-composition',
    { workspaceRoot, bindings },
    { workspaceRoot: WORKSPACE_ROOT_IDENTITY, bindings },
  );
}

function consistencySkillSelection(productRoot: string): CompositionPluginSelection {
  return runtimeSelection(
    'skill-provider-consistency-method',
    { productRoot },
    { productRoot: PRODUCT_ROOT_IDENTITY },
  );
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
    'specification-openspec': {
      config: { workspaceRoot: specificationRepository.resolvedPath, specificationRoot },
      identityConfig: { workspaceRoot: WORKSPACE_ROOT_IDENTITY, specificationRoot },
    },
  };
  const selectedProviders = [
    ...skillProviderSelections(productRoot, workspaceRoot, config, teamPlugins),
    configuredSelection(specificationProvider.id, builtinConfig, teamPlugins),
  ];
  const selectedIds = new Set(selectedProviders.map((selection) => selection.id));

  return [
    { id: 'command-router' },
    { id: 'skill-registry' },
    ...selectedProviders,
    teamSkillSelection(workspaceRoot, config),
    consistencySkillSelection(productRoot),
    { id: 'skill-command' },
    runtimeSelection(
      'specification-planning',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'specification-command' },
    { id: 'project-git' },
    { id: 'execution-workspace-git' },
    { id: 'project-probe-command' },
    runtimeSelection(
      'project-onboarding',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'project-onboarding-command' },
    { id: 'browser-maintenance' },
    runtimeSelection(
      'maintenance-command',
      { productRoot },
      { productRoot: PRODUCT_ROOT_IDENTITY },
    ),
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
    runtimeSelection(
      'work-execution-packet-store-file',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'work-execution-authority' },
    { id: 'work-execution-hosts' },
    { id: 'work-execution-sessions' },
    { id: 'runtime-work-guard' },
    runtimeSelection(
      'work-context-assembler',
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'work-dispatcher' },
    { id: 'managed-work-executor' },
    { id: 'lifecycle-definition-service' },
    { id: 'lifecycle-definition-builtin' },
    { id: 'lifecycle-validator-service' },
    { id: 'lifecycle-validator-builtin' },
    { id: 'lifecycle-extension-service' },
    { id: 'lifecycle-extension-builtin' },
    { id: 'action-manual' },
    { id: 'action-work-contributors' },
    { id: 'workflow-source-file' },
    { id: 'desktop-instance-probe' },
    runtimeSelection('desktop-launcher', { productRoot }, { productRoot: PRODUCT_ROOT_IDENTITY }),
    runtimeSelection(
      'observation-delivery',
      {
        workspaceRoot,
        ...(config.shared.telemetry
          ? { workspaceOtlpEndpoint: config.shared.telemetry.endpoint }
          : {}),
      },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'workflow-telemetry-otel' },
    { id: 'repository-input-policies' },
    { id: 'repository-input-policy-host' },
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
      { workspaceRoot },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'evidence-command' },
    runtimeSelection(
      'delivery-file',
      {
        workspaceRoot,
        ...(config.shared.delivery?.publication.apiCredential
          ? { githubTokenVariable: config.shared.delivery.publication.apiCredential.variable }
          : {}),
      },
      {
        workspaceRoot: WORKSPACE_ROOT_IDENTITY,
        ...(config.shared.delivery?.publication.apiCredential
          ? { githubTokenVariable: config.shared.delivery.publication.apiCredential.variable }
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
      {
        workspaceRoot,
        projectInput: {
          workspaceId: config.shared.workspace.id,
          workspaceRoot,
          workspaceRepositoryId: config.shared.workspace.repositoryId,
          repositories: config.repositories.map((repository) => ({
            id: repository.id,
            path: repository.resolvedPath,
          })),
        },
      },
      { workspaceRoot: WORKSPACE_ROOT_IDENTITY },
    ),
    { id: 'workflow-run-command' },
    ...(config.shared.composition?.plugins
      .filter((plugin) => !selectedIds.has(plugin.id))
      .map((plugin) => ({
        id: plugin.id,
        ...(plugin.config === undefined ? {} : { config: plugin.config }),
      })) ?? []),
  ];
}

const BASE_REQUIRED_SERVICES = [
  'actionDispatcher',
  'actionStore',
  'browserMaintenance',
  'consistencyReconciler',
  'consistencyReview',
  'commandRouter',
  'delivery',
  'desktopInstanceProbe',
  'evidenceAdapters',
  'evidenceCoordinator',
  'executionWorkspace',
  'lifecycleDefinitions',
  'lifecycleExtensions',
  'lifecycleValidators',
  'project',
  'projectOnboarding',
  'repositoryInputPolicies',
  'runStore',
  'runtimeWorkGuard',
  'managedWorkExecutor',
  'skills',
  'teamSkillComposition',
  'specification',
  'specificationPlanning',
  'workflowRuns',
  'workDispatcher',
  'workExecutionAuthority',
  'workExecutionHosts',
  'workExecutionPacketStore',
  'workExecutionSessions',
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
      // Profile contents are Evidence input, outside the composition that executes a Run.
      configuration: projectExecutionConfigDigests(
        { ...config.shared, profiles: [] },
        config.local,
      ),
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

export function compileSkillPreviewComposition(
  productRoot: string,
  workspaceRoot: string,
  config: EffectiveProjectConfig,
  catalog: ReadonlyMap<string, BuiltinPluginRegistration>,
): CompiledComposition {
  const external = config.shared.composition?.plugins ?? [];
  if (external.length) {
    throw new Error(
      `composition.plugins: read-only Skill preview cannot load executable team plugins: ${external.map(({ id }) => id).join(', ')}`,
    );
  }
  const providers = skillProviderSelections(productRoot, workspaceRoot, config, new Map());
  for (const provider of providers) {
    if (!DEFAULT_SKILL_PROVIDERS.some(({ id }) => id === provider.id)) {
      throw new Error(`skillProviders: unsupported Provider for Skill preview: ${provider.id}`);
    }
  }
  return compile(
    'repoctopus-skill-preview',
    [
      { id: 'skill-registry' },
      ...providers,
      teamSkillSelection(workspaceRoot, config),
      consistencySkillSelection(productRoot),
      { id: 'lifecycle-definition-service' },
      { id: 'lifecycle-definition-builtin' },
    ],
    ['teamSkillComposition', 'lifecycleDefinitions'],
    config,
    catalog,
  );
}
