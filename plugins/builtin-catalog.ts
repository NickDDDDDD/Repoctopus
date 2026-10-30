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
          codeDigest: 'sha256:a3d18d9854d176ad2a88b8597dc3fa80b6e64ce68faefe1d83c09ae6af62a9ba',
          descriptorDigest:
            'sha256:4e5f48cad130c375be7acc2abdbf3ff67fd9659f11a06f0a62120218bf6865fa',
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
          codeDigest: 'sha256:86232bbff896a11e5e922e60f9c0b2a6e755c0e7d3624717227d6882e1fe2d01',
          descriptorDigest:
            'sha256:e8146a5f4cc7824dfdf37f685fdff74e16808c3f2365ad86f53c2eb3d2f9034d',
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
          codeDigest: 'sha256:4805d959c0b2e3732aa1daffcc689934a660ce226db7efc7a4d6f87cdfb688a0',
          descriptorDigest:
            'sha256:357249984ada9aae4b8f8f2df4373110570ce326991a33970876394f253917b1',
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
          codeDigest: 'sha256:b29078511a9eff1f796513e755b006c65377e917dd6e3cf05b429db560ac0593',
          descriptorDigest:
            'sha256:25a81afeeff570caaa23f277244930e34d9037e1b913ecd267a737089e46f16a',
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
          codeDigest: 'sha256:24235a25f865ec4309b2967ff67cbb8aad7b8d563896b97bf3b311d26f814596',
          descriptorDigest:
            'sha256:7ad498f589335e914db2419a995c737619e02cdc1503d1c2d84b11e0c7872064',
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
