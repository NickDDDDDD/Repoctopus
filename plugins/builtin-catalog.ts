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
import projectProbeContributor from './command/project-probe-contributor.js';
import evidenceContributor from './command/evidence-contributor.js';
import workflowRunContributor from './command/workflow-run-contributor.js';
import deliveryContributor from './command/delivery-contributor.js';
import projectOnboardingContributor from './command/project-onboarding-contributor.js';
import maintenanceContributor from './command/maintenance-contributor.js';
import platformEventContributor from './command/platform-event-contributor.js';
import postMergeContributor from './command/post-merge-contributor.js';
import { FileDeliveryProvider } from './delivery/file-delivery-provider.js';
import { GitProjectProvider } from './project/git-project-provider.js';
import { FileRunStoreProvider } from './run/file-run-store-provider.js';
import { FileWorkflowSourceProvider } from './run/file-workflow-source-provider.js';
import { WorkflowTelemetryProvider } from './run/workflow-telemetry-provider.js';
import { CommandRouter } from '../services/command-router.js';
import { ActionDispatcher } from '../services/action.js';
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
import githubWebhookContributor from './events/github-webhook-contributor.js';
import githubPostMergeContributor from './events/github-post-merge-contributor.js';
import { FilePlatformEventsProvider } from './events/file-platform-events-provider.js';
import { NodeHttpHostProvider } from './http/node-http-host-provider.js';
import { OpenSpecProvider } from '../platform/specification/openspec-provider.js';
import { PlatformEventRunner } from '../services/platform-event-runner.js';
import { PostMergeCoordinator } from '../services/post-merge-coordinator.js';
import postMergeActionsProvider from './post-merge/post-merge-actions-provider.js';
import runnerApplication from './application/runner-application.js';
import desktopApplication from './application/desktop-application.js';
import { DesktopApplication } from '../services/desktop-application.js';
import { SpecificationPlanning } from '../services/specification-planning.js';

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
      id: 'http-host',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['http-listener'],
      permissions: ['network'],
      stateSchemas: {},
    },
    plugin: NodeHttpHostProvider,
    sourceFiles: [
      'services/http-host.ts',
      'platform/http/node-http-server.ts',
      'plugins/http/node-http-host-provider.ts',
    ],
  },
  {
    descriptor: {
      id: 'platform-events-file',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['event-inbox-write'],
      permissions: ['filesystem', 'network'],
      stateSchemas: { 'event-inbox': '1' },
    },
    plugin: FilePlatformEventsProvider,
    sourceFiles: [
      'domains/platform-events/inbox.ts',
      'domains/platform-events/ports.ts',
      'domains/platform-events/types.ts',
      'platform/events/file-event-inbox-store.ts',
      'platform/telemetry/platform-event-mapping.ts',
      'platform/telemetry/opentelemetry/platform-event-exporter.ts',
      'services/platform-events.ts',
      'plugins/events/file-platform-events-provider.ts',
    ],
  },
  {
    descriptor: {
      id: 'platform-event-command',
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
    plugin: platformEventContributor,
    sourceFiles: ['plugins/command/platform-event-contributor.ts'],
  },
  {
    descriptor: {
      id: 'platform-event-runner',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['event-inbox-runner'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: PlatformEventRunner,
    sourceFiles: [
      'services/operation-ownership.ts',
      'services/platform-event-runner.ts',
      'services/platform-events.ts',
    ],
  },
  {
    descriptor: {
      id: 'github-webhook-route',
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
    plugin: githubWebhookContributor,
    sourceFiles: [
      'domains/platform-events/ports.ts',
      'domains/platform-events/types.ts',
      'platform/events/github-webhook-route.ts',
      'platform/events/github-webhook.ts',
      'plugins/events/github-webhook-contributor.ts',
      'services/platform-events.ts',
    ],
  },
  {
    descriptor: {
      id: 'post-merge-coordinator',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['post-merge-coordinate'],
      permissions: [],
      stateSchemas: {},
    },
    plugin: PostMergeCoordinator,
    sourceFiles: [
      'domains/post-merge/coordinator.ts',
      'domains/post-merge/run.ts',
      'services/post-merge-coordinator.ts',
    ],
  },
  {
    descriptor: {
      id: 'github-post-merge-events',
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
    plugin: githubPostMergeContributor,
    sourceFiles: [
      'platform/git/remote-identity.ts',
      'platform/github/pull-request-event.ts',
      'plugins/events/github-post-merge-contributor.ts',
    ],
  },
  {
    descriptor: {
      id: 'post-merge-command',
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
    plugin: postMergeContributor,
    sourceFiles: [
      'plugins/command/post-merge-contributor.ts',
      'services/post-merge-coordinator.ts',
    ],
  },
  {
    descriptor: {
      id: 'post-merge-actions',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['project'],
      authorities: ['post-merge-execute'],
      permissions: ['filesystem', 'network', 'process'],
      stateSchemas: { 'post-merge-closure': '1' },
    },
    plugin: postMergeActionsProvider,
    sourceFiles: [
      'domains/post-merge/checkout.ts',
      'domains/post-merge/closure.ts',
      'platform/git/post-merge-checkout.ts',
      'platform/git/post-merge-workspace.ts',
      'plugins/post-merge/post-merge-actions-provider.ts',
      'services/post-merge-actions.ts',
    ],
  },
  {
    descriptor: {
      id: 'runner-application',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'application',
      source: 'builtin',
      compositions: ['project'],
      authorities: [],
      permissions: [],
      stateSchemas: {},
    },
    plugin: runnerApplication,
    sourceFiles: ['app/runner/application.ts', 'plugins/application/runner-application.ts'],
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
      'third_party/matt-skills/source-manifest.json',
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
    sourceFiles: ['plugins/action/manual-action-contributor.ts'],
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
    },
    plugin: FileDeliveryProvider,
    sourceFiles: [
      'services/delivery.ts',
      'services/operation-ownership.ts',
      'plugins/delivery/file-delivery-provider.ts',
      'domains/delivery/service.ts',
      'domains/delivery/service-v3.ts',
      'platform/delivery/file-delivery-store.ts',
      'platform/delivery/file-delivery-v3-store.ts',
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
    },
    plugin: WorkflowRuns,
    sourceFiles: [
      'services/workflow-runs.ts',
      'services/operation-ownership.ts',
      'domains/runtime/workflow-runs.ts',
      'domains/runtime/evidence-guard.ts',
      'domains/engine/loop.ts',
      'domains/engine/types.ts',
      'domains/skill/types.ts',
      'domains/specification/types.ts',
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
