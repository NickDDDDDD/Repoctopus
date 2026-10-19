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
      stateSchemas: { delivery: '1' },
    },
    plugin: FileDeliveryProvider,
    sourceFiles: [
      'services/delivery.ts',
      'services/operation-ownership.ts',
      'plugins/delivery/file-delivery-provider.ts',
      'domains/delivery/service.ts',
      'platform/delivery/file-delivery-store.ts',
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
