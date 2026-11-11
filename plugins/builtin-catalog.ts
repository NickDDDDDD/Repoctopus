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
import { FileWorkExecutionPacketStoreProvider } from './run/file-work-execution-packet-store-provider.js';
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
import { RepositoryInputPolicies } from '../services/repository-input-policies.js';
import builtinHostInputPolicy from './evidence/builtin-host-input-policy.js';
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
import { DesktopReceiverInstanceProbe } from '../app/desktop/host/receiver-instance-probe.js';
import { ObservationDelivery } from '../services/observation-delivery.js';
import { SpecificationPlanning } from '../services/specification-planning.js';
import { ConsistencyReconciler } from '../services/consistency-reconciler.js';
import consistencyContributor from './command/consistency-contributor.js';
import consistencyMethodProvider from './skill/consistency-method-provider.js';
import lifecycleSkillProvider from './skill/lifecycle-skill-provider.js';
import { ConsistencyReviewService } from '../services/consistency-review.js';
import { TeamSkillComposition } from '../services/team-skill-composition.js';

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
      id: 'desktop-instance-probe',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: ['filesystem', 'network', 'process'],
      stateSchemas: {},
    },
    plugin: DesktopReceiverInstanceProbe,
    sourceFiles: [
      'app/desktop/host/receiver-instance-probe.ts',
      'app/desktop/host/receiver-discovery.ts',
      'app/desktop/shared/instance-probe.ts',
      'app/desktop/shared/receiver-health.ts',
    ],
  },
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
      permissions: ['filesystem', 'process'],
      stateSchemas: {},
    },
    plugin: DesktopLauncher,
    sourceFiles: [
      'services/desktop-launcher.ts',
      'app/desktop/shared/launch-context.ts',
      'app/desktop/shared/instance-probe.ts',
    ],
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
      'domains/telemetry/observation-contract.ts',
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
      'app/desktop/shared/receiver-health.ts',
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
      'platform/project-configuration/workspace-guides.ts',
      'domains/project-configuration/workspace-guides.ts',
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
      id: 'team-skill-composition',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['team-skill-composition'],
      permissions: ['filesystem'],
      stateSchemas: {},
    },
    plugin: TeamSkillComposition,
    sourceFiles: [
      'services/team-skill-composition.ts',
      'domains/skill/composition.ts',
      'platform/skill/snapshot.ts',
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
      compatibleImplementations: [
        {
          codeDigest: 'sha256:a3f9fbd774e4b7ad13a874011331f69319db9acce58edc4ecbd1fcf697473c4f',
          descriptorDigest:
            'sha256:437c5b1befe64b8d8d1a9f49eb1d950217bc51a9d6cd7a8424841725d50ec8ff',
        },
      ],
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
      id: 'work-execution-packet-store-file',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['work-execution-packet-store-write'],
      permissions: ['filesystem'],
      stateSchemas: { 'work-execution-packet': '1' },
      compatibleImplementations: [
        {
          codeDigest: 'sha256:b30981bc7faaf165355b4178366ccf06de0a0ba3a947e481849b64fedbe84ab0',
          descriptorDigest:
            'sha256:0afa27bbb7ed289817f2fd7cf0c5fadc18847774df28e42143015ea9bf4d0a05',
        },
      ],
    },
    plugin: FileWorkExecutionPacketStoreProvider,
    sourceFiles: [
      'domains/work-execution/ports.ts',
      'domains/work-execution/types.ts',
      'services/work-execution-packet-store.ts',
      'plugins/run/file-work-execution-packet-store-provider.ts',
      'platform/runtime/file-work-execution-packet-store.ts',
    ],
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
      stateSchemas: { 'work-execution': '2' },
      compatibleImplementations: [
        {
          codeDigest: 'sha256:cf97d6949b11dcf5b9d4eb8c84a8962bf3aeae9d21675afb0497b1ca5889f74c',
          descriptorDigest:
            'sha256:eecfcc944df7ca93fde319036c6a3fe42a31f4c33e75d746ea3305144b7a2dee',
        },
      ],
    },
    plugin: WorkExecutionAuthority,
    sourceFiles: [
      'domains/work-execution/acceptance.ts',
      'domains/work-execution/types.ts',
      'domains/telemetry/rule-evaluation.ts',
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
      compatibleImplementations: [
        {
          codeDigest: 'sha256:02025f31a26c6bbc9fd55fdf75d58e19ff7d43e907eb3b702ef8116975b06fe4',
          descriptorDigest:
            'sha256:0d197abb829997893bab869e96e4d1bbbc4902ddaeddddecb852dc301ca767aa',
        },
      ],
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
      compatibleImplementations: [
        {
          codeDigest: 'sha256:02025f31a26c6bbc9fd55fdf75d58e19ff7d43e907eb3b702ef8116975b06fe4',
          descriptorDigest:
            'sha256:7a0c7292228b2a06c019eec92cf57d3109690e62951be89b5c54bdbf492706e9',
        },
      ],
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
          codeDigest: 'sha256:b6c1c1a06f07f438192c24623a0c8ee5b7026703aa1b187aa2a7dc5322f3396f',
          descriptorDigest:
            'sha256:1484807be04f35293ac08ebbea0954fc99975f6c14509cf78a61e71c8b73f830',
        },
      ],
    },
    plugin: ManagedWorkExecutor,
    sourceFiles: [
      'domains/work-execution/acceptance.ts',
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
      compatibleImplementations: [
        {
          codeDigest: 'sha256:8871a99bb63291306173606554b1e9fc6a019cd261159350dbc7af5aa44f7135',
          descriptorDigest:
            'sha256:9ea17bc9df73f75b5c596e19167b91d89438914b99e92350f434accd6f3924c0',
        },
      ],
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
          codeDigest: 'sha256:ad89f07de38386eba277c8f94dbf1dbc266bf34e31d24108962f726e495815e1',
          descriptorDigest:
            'sha256:a404e2fdd15791971f77456acd3d91969107621e3a510acff9ecc86c5d1950aa',
        },
      ],
    },
    plugin: builtinLifecycleDefinition,
    sourceFiles: [
      'domains/change-lifecycle/definition.ts',
      'domains/change-lifecycle/build-protocol.ts',
      'domains/delivery/branch-policy.ts',
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
          codeDigest: 'sha256:fcd874bea2ec44fe16e58ea2628017ba3a614ee54ce95bcf9e339c817f90f09f',
          descriptorDigest:
            'sha256:fb3edf9da190de8f6a459a2c975874bc453ee3fde8e52f57fd234b4316fb18e7',
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
          codeDigest: 'sha256:f0ef03c66bb3ee2e51ac910a1ad0071674044d0afb1f5724670c5054fd50a02a',
          descriptorDigest:
            'sha256:27231ac5e21cddddf63064ef5a4125fc274f15ddb10b71c4d8190cf892842d40',
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
      'platform/telemetry/opentelemetry/config.ts',
    ],
  },
  {
    descriptor: {
      id: 'repository-input-policies',
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
    plugin: RepositoryInputPolicies,
    sourceFiles: [
      'services/repository-input-policies.ts',
      'domains/evidence/repository-input-policy.ts',
    ],
  },
  {
    descriptor: {
      id: 'repository-input-policy-host',
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
    plugin: builtinHostInputPolicy,
    sourceFiles: ['plugins/evidence/builtin-host-input-policy.ts'],
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
          codeDigest: 'sha256:e788833a2a494d3fc300e4c795597c7e629cefc705fd98d1b594c8192d58e13b',
          descriptorDigest:
            'sha256:1cbfdf734f2ff047f21df1c22b6061781f13485cc23aa4818683a1efa8ac6445',
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
      'domains/delivery/publication-journal.ts',
      'domains/delivery/publication-not-applied.ts',
      'domains/delivery/publication-result-unknown.ts',
      'domains/delivery/specification-publication-journal.ts',
      'domains/delivery/stable-publication.ts',
      'domains/delivery/branch-policy.ts',
      'platform/delivery/file-delivery-store.ts',
      'platform/delivery/file-delivery-v3-store.ts',
      'platform/delivery/file-publication-journal-store.ts',
      'platform/delivery/file-specification-publication-journal-store.ts',
      'platform/delivery/specification-publication.ts',
      'platform/git/delivery.ts',
      'platform/git/archive-git.ts',
      'platform/git/specification-checkout.ts',
      'platform/github/merge-request.ts',
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
          codeDigest: 'sha256:0054b1fd3c9cbbc1b9ccd82ce396a0d230fe4120ca1ca799fa61231a6cdf531a',
          descriptorDigest:
            'sha256:2e4683748cf8450219c8cab108164b39ab54561c94d90981d26ad2b315dad0dc',
        },
      ],
    },
    plugin: WorkflowRuns,
    sourceFiles: [
      'services/build-work-outcome-acceptance.ts',
      'services/lifecycle-human-decisions.ts',
      'services/workflow-runs.ts',
      'domains/work-execution/acceptance.ts',
      'services/operation-ownership.ts',
      'domains/runtime/workflow-runs.ts',
      'domains/runtime/build-workspace-recovery.ts',
      'domains/runtime/evidence-guard.ts',
      'domains/change-lifecycle/definition.ts',
      'domains/change-lifecycle/host-workflow.ts',
      'domains/change-lifecycle/human-decision.ts',
      'domains/change-lifecycle/transition.ts',
      'domains/change-lifecycle/build-protocol.ts',
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
