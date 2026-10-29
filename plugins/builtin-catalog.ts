import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createBuiltinCatalog,
  PLUGIN_CONTRACT_VERSION,
  type BuiltinPluginRegistration,
  type PluginDescriptor,
  type PluginPermission,
} from '../app/boot/descriptor.js';
import { FileActionStoreProvider } from './action/file-action-store-provider.js';
import manualActionContributor from './action/manual-action-contributor.js';
import runtimeWorkContributors from './action/runtime-work-contributors.js';
import builtinLifecycleDefinition from './lifecycle/builtin-definition-contributor.js';
import builtinLifecycleValidators from './lifecycle/builtin-validator-contributor.js';
import builtinLifecycleExtensions from './lifecycle/builtin-extension-contributor.js';
import projectProbeContributor from './command/project-probe-contributor.js';
import evidenceContributor from './command/evidence-contributor.js';
import workflowRunContributor from './command/workflow-run-contributor.js';
import deliveryContributor from './command/delivery-contributor.js';
import projectOnboardingContributor from './command/project-onboarding-contributor.js';
import maintenanceContributor from './command/maintenance-contributor.js';
import { FileDeliveryProvider } from './delivery/file-delivery-provider.js';
import { GitProjectProvider } from './project/git-project-provider.js';
import { GitExecutionWorkspaceProvider } from './project/git-execution-workspace-provider.js';
import { FileRunStoreProvider } from './run/file-run-store-provider.js';
import { FileWorkflowSourceProvider } from './run/file-workflow-source-provider.js';
import { WorkflowTelemetryProvider } from './run/workflow-telemetry-provider.js';
import { CommandRouter } from '../services/command-router.js';
import { ActionDispatcher } from '../services/action.js';
import { RuntimeWorkGuard } from '../services/runtime-work-guard.js';
import { WorkDispatcher } from '../services/work-dispatcher.js';
import { WorkExecutionAuthority } from '../services/work-execution-authority.js';
import { WorkExecutionHosts, WorkExecutionSessions } from '../services/work-execution-hosts.js';
import { ManagedWorkExecutor } from '../services/managed-work-executor.js';
import { WorkContextAssembler } from '../services/work-context-assembler.js';
import {
  LifecycleDefinitions,
  LifecycleExtensions,
  LifecycleValidators,
} from '../services/lifecycle-contributors.js';
import { EvidenceCoordinator } from '../services/evidence-coordinator.js';
import { EvidenceAdapters } from '../services/evidence-adapters.js';
import {
  fileVisualContributor,
  localBrowserContributor,
  localCommandContributor,
  localServiceContributor,
} from './evidence/local-adapter-contributors.js';
import { WorkflowRuns } from '../services/workflow-runs.js';
import { ProjectOnboarding } from '../services/project-onboarding.js';
import { BrowserMaintenance } from '../services/browser-maintenance.js';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import mattSkillProvider from './skill/matt-skill-provider.js';
import filesystemSkillProvider from './skill/filesystem-skill-provider.js';
import skillCatalogContributor from './command/skill-catalog-contributor.js';
import specificationContributor from './command/specification-contributor.js';
import { OpenSpecProvider } from '../platform/specification/openspec-provider.js';
import desktopApplication from './application/desktop-application.js';
import { DesktopApplication } from '../services/desktop-application.js';
import { DesktopProjection } from '../services/desktop-projection.js';
import { DesktopReceiver } from '../services/desktop-receiver.js';
import { DesktopLauncher } from '../services/desktop-launcher.js';
import { ObservationDelivery } from '../services/observation-delivery.js';
import { SpecificationPlanning } from '../services/specification-planning.js';
import { ConsistencyReconciler } from '../services/consistency-reconciler.js';
import consistencyContributor from './command/consistency-contributor.js';
import consistencyMethodProvider from './skill/consistency-method-provider.js';
import lifecycleSkillProvider from './skill/lifecycle-skill-provider.js';
import { ConsistencyReviewService } from '../services/consistency-review.js';

interface BuiltinDefinition {
  descriptor: Omit<PluginDescriptor, 'codeDigest'>;
  plugin: BuiltinPluginRegistration['plugin'];
  sourceFiles: readonly string[];
}

const VERSION = '0.1.0';

interface EvidenceAdapterDefinition {
  id: string;
  plugin: BuiltinPluginRegistration['plugin'];
  authority: string;
  permissions: readonly PluginPermission[];
  sourceFiles: readonly string[];
}

const evidenceAdapterDefinitions: readonly EvidenceAdapterDefinition[] = [
  {
    id: 'evidence-command-local',
    plugin: localCommandContributor,
    authority: 'command-evidence-adapter',
    permissions: ['filesystem', 'process'],
    sourceFiles: ['platform/feedback/command-adapter.ts'],
  },
  {
    id: 'evidence-service-local',
    plugin: localServiceContributor,
    authority: 'service-evidence-adapter',
    permissions: ['filesystem', 'process'],
    sourceFiles: ['platform/feedback/service-adapter.ts'],
  },
  {
    id: 'evidence-browser-local',
    plugin: localBrowserContributor,
    authority: 'browser-evidence-adapter',
    permissions: ['browser', 'filesystem', 'process'],
    sourceFiles: ['platform/browser/browser-adapter.ts'],
  },
  {
    id: 'evidence-visual-file',
    plugin: fileVisualContributor,
    authority: 'visual-evidence-adapter',
    permissions: ['filesystem'],
    sourceFiles: ['platform/feedback/file-exchange-visual-adapter.ts'],
  },
];

const definitions: readonly BuiltinDefinition[] = [
  {
    descriptor: {
      id: 'desktop-launcher',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['desktop-launch'],
      permissions: ['process'],
      stateSchemas: {},
    },
    plugin: DesktopLauncher,
    sourceFiles: ['services/desktop-launcher.ts', 'app/desktop/shared/launch-context.ts'],
  },
  {
    descriptor: {
      id: 'observation-delivery',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['observation-envelope-store'],
      permissions: ['filesystem', 'network'],
      stateSchemas: { 'observation-envelope-store': '2' },
    },
    plugin: ObservationDelivery,
    sourceFiles: [
      'services/observation-delivery.ts',
      'services/observation-pipeline.ts',
      'domains/trajectory/observation.ts',
      'app/desktop/host/otlp-envelope-codec.ts',
    ],
  },
  {
    descriptor: {
      id: 'desktop-projection-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['desktop'],
      authorities: ['desktop-projection'],
      permissions: [],
      stateSchemas: { 'desktop-projection': '1' },
    },
    plugin: DesktopProjection,
    sourceFiles: ['services/desktop-projection.ts', 'domains/trajectory/projection.ts'],
  },
  {
    descriptor: {
      id: 'desktop-receiver-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['desktop'],
      authorities: ['desktop-otlp-receiver'],
      permissions: ['network'],
      stateSchemas: {},
    },
    plugin: DesktopReceiver,
    sourceFiles: [
      'services/desktop-receiver.ts',
      'app/desktop/host/otlp-http-receiver.ts',
      'app/desktop/host/otlp-envelope-codec.ts',
    ],
  },
  {
    descriptor: {
      id: 'desktop-application-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['desktop'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: DesktopApplication,
    sourceFiles: ['services/desktop-application.ts'],
  },
  {
    descriptor: {
      id: 'desktop-application',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'application',
      source: 'builtin',
      compositions: ['desktop'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: desktopApplication,
    sourceFiles: ['plugins/application/desktop-application.ts'],
  },
  {
    descriptor: {
      id: 'project-onboarding',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: ['project-configuration-write'],
      permissions: ['filesystem'],
      stateSchemas: { 'project-configuration': '1' },
    },
    plugin: ProjectOnboarding,
    sourceFiles: [
      'services/project-onboarding.ts',
      'platform/project-configuration/onboarding.ts',
      'platform/project-configuration/detect.ts',
      'platform/project-configuration/gitignore.ts',
    ],
  },
  {
    descriptor: {
      id: 'project-onboarding-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: projectOnboardingContributor,
    sourceFiles: ['plugins/command/project-onboarding-contributor.ts'],
  },
  {
    descriptor: {
      id: 'browser-maintenance',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: ['managed-browser-install'],
      permissions: ['filesystem', 'network', 'process'],
      stateSchemas: {},
    },
    plugin: BrowserMaintenance,
    sourceFiles: ['services/browser-maintenance.ts', 'platform/browser/managed-browser.ts'],
  },
  {
    descriptor: {
      id: 'maintenance-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: maintenanceContributor,
    sourceFiles: ['plugins/command/maintenance-contributor.ts', 'platform/provenance/check.ts'],
  },
  {
    descriptor: {
      id: 'command-router',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: CommandRouter,
    sourceFiles: ['services/command-router.ts'],
  },
  {
    descriptor: {
      id: 'skill-registry',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['skill-registry'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: SkillRegistry,
    sourceFiles: ['third_party/dsh-adoption.json'],
  },
  {
    descriptor: {
      id: 'skill-provider-matt',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: mattSkillProvider,
    sourceFiles: [
      'plugins/skill/file-skill-provider.ts',
      'plugins/skill/matt-skill-provider.ts',
      'third_party/matt-skills/method-adoptions.json',
      'third_party/matt-skills/source-manifest.json',
    ],
  },
  {
    descriptor: {
      id: 'skill-provider-lifecycle',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: lifecycleSkillProvider,
    sourceFiles: [
      'plugins/skill/file-skill-provider.ts',
      'plugins/skill/lifecycle-skill-provider.ts',
      'skills/lifecycle/repoctopus-open-change/SKILL.md',
      'skills/lifecycle/repoctopus-design-change/SKILL.md',
      'skills/lifecycle/repoctopus-build-configure/SKILL.md',
      'skills/lifecycle/repoctopus-build-plan/SKILL.md',
      'skills/lifecycle/repoctopus-build-execute/SKILL.md',
      'skills/lifecycle/repoctopus-build-check/SKILL.md',
      'skills/lifecycle/repoctopus-verify-change/SKILL.md',
      'skills/lifecycle/repoctopus-archive-change/SKILL.md',
    ],
  },
  {
    descriptor: {
      id: 'skill-provider-filesystem',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: filesystemSkillProvider,
    sourceFiles: [
      'plugins/skill/file-skill-provider.ts',
      'plugins/skill/filesystem-skill-provider.ts',
    ],
  },
  {
    descriptor: {
      id: 'skill-provider-consistency-method',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: consistencyMethodProvider,
    sourceFiles: [
      'plugins/skill/file-skill-provider.ts',
      'plugins/skill/consistency-method-provider.ts',
      'third_party/matt-skills/method-adoptions.json',
    ],
  },
  {
    descriptor: {
      id: 'skill-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: skillCatalogContributor,
    sourceFiles: ['plugins/command/skill-catalog-contributor.ts', 'platform/skill/projector.ts'],
  },
  {
    descriptor: {
      id: 'specification-openspec',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['specification-authority'],
      permissions: ['filesystem', 'process'],
      stateSchemas: { specification: '1' },
    },
    plugin: OpenSpecProvider,
    sourceFiles: [
      'services/specification.ts',
      'domains/specification/tasks.ts',
      'domains/specification/types.ts',
      'platform/specification/openspec-process.ts',
      'platform/specification/openspec-provider.ts',
    ],
  },
  {
    descriptor: {
      id: 'specification-planning',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem'],
      stateSchemas: { 'specification-approval': '1' },
    },
    plugin: SpecificationPlanning,
    sourceFiles: [
      'services/specification-planning.ts',
      'domains/specification/planning-approval.ts',
      'platform/specification/file-planning-approval-store.ts',
    ],
  },
  {
    descriptor: {
      id: 'specification-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: specificationContributor,
    sourceFiles: ['plugins/command/specification-contributor.ts'],
  },
  {
    descriptor: {
      id: 'project-git',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: ['project-probe'],
      permissions: ['filesystem', 'process'],
      stateSchemas: {},
    },
    plugin: GitProjectProvider,
    sourceFiles: [
      'services/project.ts',
      'plugins/project/git-project-provider.ts',
      'platform/git/change-branch.ts',
      'platform/git/remote-identity.ts',
      'platform/git/probe.ts',
    ],
  },
  {
    descriptor: {
      id: 'execution-workspace-git',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['execution-workspace-binding'],
      permissions: ['filesystem', 'process'],
      stateSchemas: {},
    },
    plugin: GitExecutionWorkspaceProvider,
    sourceFiles: [
      'services/execution-workspace.ts',
      'plugins/project/git-execution-workspace-provider.ts',
      'platform/git/execution-workspace.ts',
    ],
  },
  {
    descriptor: {
      id: 'project-probe-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['bootstrap', 'project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: projectProbeContributor,
    sourceFiles: ['plugins/command/project-probe-contributor.ts'],
  },
  {
    descriptor: {
      id: 'evidence-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: evidenceContributor,
    sourceFiles: ['plugins/command/evidence-contributor.ts'],
  },
  {
    descriptor: {
      id: 'action-store-file',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['action-store-write'],
      permissions: ['filesystem'],
      stateSchemas: { action: '1' },
    },
    plugin: FileActionStoreProvider,
    sourceFiles: [
      'services/action.ts',
      'plugins/action/file-action-store-provider.ts',
      'platform/action/file-action-store.ts',
    ],
  },
  {
    descriptor: {
      id: 'action-dispatcher',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: ActionDispatcher,
    sourceFiles: ['services/action.ts'],
  },
  {
    descriptor: {
      id: 'work-execution-authority',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['work-execution-state'],
      permissions: [],
      stateSchemas: { 'work-execution': '1' },
      compatibleImplementations: [
        {
          codeDigest: 'sha256:bb5ed1fa9ea6fe418102fc13e558f630efa80400e4dde11612bed411c0608d71',
          descriptorDigest:
            'sha256:8a5f106a29257672c585da2de20f6dd1c7bfcef4c432b23fa9ec918c7a533f23',
        },
      ],
    },
    plugin: WorkExecutionAuthority,
    sourceFiles: [
      'domains/work-execution/types.ts',
      'services/work-execution-authority.ts',
      'platform/runtime/file-runtime-store.ts',
    ],
  },
  {
    descriptor: {
      id: 'runtime-work-guard',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['runtime-work-guard'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: RuntimeWorkGuard,
    sourceFiles: [
      'domains/change-lifecycle/work-guard.ts',
      'services/runtime-work-guard.ts',
      'services/command-router.ts',
    ],
  },
  {
    descriptor: {
      id: 'work-execution-hosts',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['work-execution-host-registry'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: WorkExecutionHosts,
    sourceFiles: ['domains/work-execution/types.ts', 'services/work-execution-hosts.ts'],
  },
  {
    descriptor: {
      id: 'work-execution-sessions',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['work-execution-session'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: WorkExecutionSessions,
    sourceFiles: ['domains/work-execution/types.ts', 'services/work-execution-hosts.ts'],
  },
  {
    descriptor: {
      id: 'managed-work-executor',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['managed-work-execution'],
      permissions: [],
      stateSchemas: {},
      compatibleImplementations: [
        {
          codeDigest: 'sha256:0cf7cfbc39537eaa33d8f06ef13495a3db6f0a922378182f385c982f008ebef0',
          descriptorDigest:
            'sha256:a2fd8a42223fa0171b40f9951648af1926b4dfce501ba8360fc59daedc04cd6b',
        },
      ],
    },
    plugin: ManagedWorkExecutor,
    sourceFiles: [
      'domains/work-execution/types.ts',
      'services/managed-work-executor.ts',
      'services/work-execution-authority.ts',
      'services/work-execution-hosts.ts',
    ],
  },
  {
    descriptor: {
      id: 'work-context-assembler',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['work-context'],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: WorkContextAssembler,
    sourceFiles: [
      'domains/change-lifecycle/method-profile.ts',
      'domains/change-lifecycle/work-context.ts',
      'platform/skill/snapshot.ts',
      'services/work-context-assembler.ts',
    ],
  },
  {
    descriptor: {
      id: 'work-dispatcher',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['work-dispatch'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: WorkDispatcher,
    sourceFiles: ['domains/action/types.ts', 'services/action.ts', 'services/work-dispatcher.ts'],
  },
  {
    descriptor: {
      id: 'lifecycle-definition-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['lifecycle-definition-registry'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: LifecycleDefinitions,
    sourceFiles: ['domains/change-lifecycle/contributors.ts', 'services/lifecycle-contributors.ts'],
  },
  {
    descriptor: {
      id: 'lifecycle-definition-builtin',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['lifecycle-definition'],
      permissions: [],
      stateSchemas: {},
      compatibleImplementations: [
        {
          codeDigest: 'sha256:57b06d72816f137c436f7081274771bc7331ce4850d0a9b117f76eb4a4c06390',
          descriptorDigest:
            'sha256:b392a5160f3e93ea4fc1971e17a390fcc3e9c94d3b6babcc5d309a1d97c3690f',
        },
        {
          codeDigest: 'sha256:2926551cac3ad5a47cb6e6f4a285425c150caac2d82c1c4d291f8ec9f7251436',
          descriptorDigest:
            'sha256:9dfa238c84298c5fd26500cf0519e605afe70bb2508f48d87554609c48d00930',
        },
        {
          codeDigest: 'sha256:ccd3c55bc617831309b4acc220ff0ab85daa1f52f1d036d16da2eb81f2f01e25',
          descriptorDigest:
            'sha256:50a53cf313733271140de690dc4a6949ea04507f44cae75b18b7846fc6b7a1ca',
        },
      ],
    },
    plugin: builtinLifecycleDefinition,
    sourceFiles: [
      'domains/change-lifecycle/definition.ts',
      'domains/change-lifecycle/build-protocol.ts',
      'domains/change-lifecycle/build-work.ts',
      'plugins/lifecycle/builtin-definition-contributor.ts',
    ],
  },
  {
    descriptor: {
      id: 'lifecycle-validator-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['lifecycle-validator-registry'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: LifecycleValidators,
    sourceFiles: ['domains/change-lifecycle/contributors.ts', 'services/lifecycle-contributors.ts'],
  },
  {
    descriptor: {
      id: 'lifecycle-validator-builtin',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['lifecycle-validator'],
      permissions: [],
      stateSchemas: {},
      compatibleImplementations: [
        {
          codeDigest: 'sha256:839b768c34ff83b40051dc26b1b71d0fbc2cbff9701113034047bf6e45abc209',
          descriptorDigest:
            'sha256:e7778ae3f8f2e6dbb0442ff42c5dc7e275512276258c809ff893668af6b84044',
        },
        {
          codeDigest: 'sha256:cb472a770aacb43e7b73c8969531889b294af30c06e66e99c086908a70db34dc',
          descriptorDigest:
            'sha256:a87e4735dd873231d22125896f04cc5bcbd03074858d437309009feac4f76da2',
        },
        {
          codeDigest: 'sha256:cdd4a7fc826169ddc38a1fe76716e59891c8bcbba97312604a8ae31a01d1a064',
          descriptorDigest:
            'sha256:d787876afcb2173b484ae27b050d6b89a50dd4d4dd16f030ab2416ec2becff02',
        },
      ],
    },
    plugin: builtinLifecycleValidators,
    sourceFiles: [
      'domains/change-lifecycle/definition.ts',
      'plugins/lifecycle/builtin-validator-contributor.ts',
    ],
  },
  {
    descriptor: {
      id: 'lifecycle-extension-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['lifecycle-extension-registry'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: LifecycleExtensions,
    sourceFiles: ['domains/change-lifecycle/contributors.ts', 'services/lifecycle-contributors.ts'],
  },
  {
    descriptor: {
      id: 'lifecycle-extension-builtin',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['lifecycle-extension'],
      permissions: [],
      stateSchemas: {},
      compatibleImplementations: [
        {
          codeDigest: 'sha256:1ae35c29ff680a1644e86e62c77d5eb9c90ae3ad6fde7b1657b2ddda5bb55820',
          descriptorDigest:
            'sha256:1b0ea9b397cf918f1e449a848bac1e816304d42ea0110b38c031e265e112e309',
        },
        {
          codeDigest: 'sha256:18359f2ee893508d1f4f4903c6479d3272abfb036e74f8694bedec7873541f03',
          descriptorDigest:
            'sha256:efa84ce4e4bbfaad450dfe6628f396aebfd7e411725c3cb42ee5d4db8ea129d6',
        },
        {
          codeDigest: 'sha256:b86cd92087acf6c70bc5e4dfc7a08e9a2732a53c0111328b66396e6b18d660e4',
          descriptorDigest:
            'sha256:5a2a9e443841bc41e9c4634f3a8aa29d6c17bade967c260bbe739653a17d705f',
        },
      ],
    },
    plugin: builtinLifecycleExtensions,
    sourceFiles: [
      'domains/change-lifecycle/definition.ts',
      'plugins/lifecycle/builtin-extension-contributor.ts',
    ],
  },
  {
    descriptor: {
      id: 'action-work-contributors',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['action-adapter:git', 'action-adapter:process', 'action-adapter:specification'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: runtimeWorkContributors,
    sourceFiles: ['plugins/action/runtime-work-contributors.ts', 'services/work-dispatcher.ts'],
  },
  {
    descriptor: {
      id: 'action-manual',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['action-adapter:manual'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: manualActionContributor,
    sourceFiles: ['plugins/action/manual-action-contributor.ts', 'services/work-dispatcher.ts'],
  },
  {
    descriptor: {
      id: 'run-store-file',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['run-store-write'],
      permissions: ['filesystem'],
      stateSchemas: { checkpoint: '1', run: '1', trajectory: '1' },
    },
    plugin: FileRunStoreProvider,
    sourceFiles: [
      'services/run-store.ts',
      'plugins/run/file-run-store-provider.ts',
      'platform/runtime/file-runtime-store.ts',
      'platform/runtime/recoverable-file-lock.ts',
      'platform/runtime/recoverable-file-transition.ts',
    ],
  },
  {
    descriptor: {
      id: 'workflow-source-file',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: FileWorkflowSourceProvider,
    sourceFiles: [
      'services/workflow-support.ts',
      'plugins/run/file-workflow-source-provider.ts',
      'platform/workflow/file-source.ts',
    ],
  },
  {
    descriptor: {
      id: 'workflow-telemetry-otel',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['network'],
      stateSchemas: {},
    },
    plugin: WorkflowTelemetryProvider,
    sourceFiles: [
      'services/workflow-support.ts',
      'services/observation-telemetry.ts',
      'plugins/run/workflow-telemetry-provider.ts',
      'platform/telemetry/opentelemetry/exporter.ts',
    ],
  },
  {
    descriptor: {
      id: 'evidence-adapters',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: EvidenceAdapters,
    sourceFiles: ['services/evidence-adapters.ts'],
  },
  ...evidenceAdapterDefinitions.map(({ id, plugin, authority, permissions, sourceFiles }) => ({
    descriptor: {
      id,
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor' as const,
      source: 'builtin' as const,
      compositions: ['project'] as const,
      authorities: [authority],
      permissions,
      stateSchemas: {},
    },
    plugin,
    sourceFiles: ['plugins/evidence/local-adapter-contributors.ts', ...sourceFiles],
  })),
  {
    descriptor: {
      id: 'evidence-coordinator',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['evidence-gate'],
      permissions: ['filesystem', 'process', 'network', 'browser'],
      stateSchemas: { evidence: '1' },
    },
    plugin: EvidenceCoordinator,
    sourceFiles: [
      'services/evidence-coordinator.ts',
      'services/operation-ownership.ts',
      'domains/evidence/service.ts',
      'domains/evidence/recovery.ts',
    ],
  },
  {
    descriptor: {
      id: 'delivery-file',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['delivery-state-write'],
      permissions: ['filesystem', 'process', 'network'],
      stateSchemas: { delivery: '2|3' },
      compatibleImplementations: [
        {
          codeDigest: 'sha256:fc2ca8286f660b259ccd1a4d1bdc42cf8f75843aed55743cf9fe788fd7ff276e',
          descriptorDigest:
            'sha256:3de2ec154dacf4e714d388da14e2a14a5f59f66909e7890e55f6fab92634567b',
        },
      ],
    },
    plugin: FileDeliveryProvider,
    sourceFiles: [
      'services/delivery.ts',
      'services/operation-ownership.ts',
      'plugins/delivery/file-delivery-provider.ts',
      'domains/delivery/service.ts',
      'domains/delivery/service-v3.ts',
      'domains/delivery/specification-publication-journal.ts',
      'platform/delivery/file-delivery-store.ts',
      'platform/delivery/file-delivery-v3-store.ts',
      'platform/delivery/file-specification-publication-journal-store.ts',
      'platform/delivery/specification-publication.ts',
      'platform/git/delivery.ts',
      'platform/git/specification-checkout.ts',
    ],
  },
  {
    descriptor: {
      id: 'delivery-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: deliveryContributor,
    sourceFiles: ['plugins/command/delivery-contributor.ts'],
  },
  {
    descriptor: {
      id: 'workflow-runs',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['workflow-transition'],
      permissions: [],
      stateSchemas: { run: '1' },
      compatibleImplementations: [
        {
          codeDigest: 'sha256:d5485e4633c9fc310f2fcc58157b38f229ddc8d825a9cb522bacfe35c8bcf244',
          descriptorDigest:
            'sha256:492b090f7be17881f848a3d00f7708665eb961b8454cb1a3c8907bc63c5688e4',
        },
        {
          codeDigest: 'sha256:a3b4c7bbcba89f3776e6c37e12e91665376ed99f899b6e30c07004cc78c01783',
          descriptorDigest:
            'sha256:57b826c484e8ee22ab3b09d9ccb933bf8de79a7b25d2a64a43739047b261052f',
        },
        {
          codeDigest: 'sha256:b402fe98d8867d618a421d4aa06e71f7428aa235bd8e918ada71f9e70f0fcb04',
          descriptorDigest:
            'sha256:f2e5447d57b4f4e81e8ab2adc0941f28bf1555e6915a5efe6f5c5e6b201ca3a5',
        },
        {
          codeDigest: 'sha256:9a53c8d23a6964b54a43e1b33c0e4d6a75edb52a44ff330715994bede9eeaa73',
          descriptorDigest:
            'sha256:b91fad7967cdd2ff81ea86d4b94ce482858bda40d8df95a4a7e3aa032b4ab387',
        },
      ],
    },
    plugin: WorkflowRuns,
    sourceFiles: [
      'services/workflow-runs.ts',
      'services/operation-ownership.ts',
      'domains/runtime/workflow-runs.ts',
      'domains/runtime/evidence-guard.ts',
      'domains/change-lifecycle/definition.ts',
      'domains/change-lifecycle/host-workflow.ts',
      'domains/change-lifecycle/transition.ts',
      'domains/change-lifecycle/archive-input.ts',
      'domains/change-lifecycle/verification-input.ts',
      'domains/change-lifecycle/verify-work.ts',
      'domains/engine/loop.ts',
      'domains/engine/types.ts',
      'domains/skill/types.ts',
      'domains/specification/types.ts',
      'platform/skill/snapshot.ts',
    ],
  },
  {
    descriptor: {
      id: 'consistency-reconciler',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['consistency-impact-review'],
      permissions: ['filesystem', 'network'],
      stateSchemas: { consistency: '1' },
    },
    plugin: ConsistencyReconciler,
    sourceFiles: [
      'services/consistency-reconciler.ts',
      'domains/consistency/review.ts',
      'platform/consistency/file-consistency-store.ts',
    ],
  },
  {
    descriptor: {
      id: 'consistency-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: consistencyContributor,
    sourceFiles: ['plugins/command/consistency-contributor.ts'],
  },
  {
    descriptor: {
      id: 'consistency-review',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['consistency-review-write'],
      permissions: ['filesystem'],
      stateSchemas: { consistency: '1' },
    },
    plugin: ConsistencyReviewService,
    sourceFiles: [
      'services/consistency-review.ts',
      'domains/consistency/review.ts',
      'platform/consistency/file-consistency-store.ts',
      'platform/skill/snapshot.ts',
    ],
  },
  {
    descriptor: {
      id: 'workflow-run-command',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'contributor',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: workflowRunContributor,
    sourceFiles: ['plugins/command/workflow-run-contributor.ts'],
  },
];

async function codeDigest(
  root: string,
  sourceFiles: readonly string[],
): Promise<`sha256:${string}`> {
  const hash = createHash('sha256');
  for (const relative of [...sourceFiles].sort((left, right) => left.localeCompare(right))) {
    hash.update(relative);
    hash.update('\0');
    hash.update(await readFile(path.join(root, relative)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function createRepoctopusBuiltinCatalog(
  productRoot: string,
): Promise<ReadonlyMap<string, BuiltinPluginRegistration>> {
  const registrations = await Promise.all(
    definitions.map(async (definition) => ({
      descriptor: {
        ...definition.descriptor,
        codeDigest: await codeDigest(productRoot, definition.sourceFiles),
      },
      plugin: definition.plugin,
    })),
  );
  return createBuiltinCatalog(registrations);
}
