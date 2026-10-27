import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createBuiltinCatalog,
  PLUGIN_CONTRACT_VERSION,
  type BuiltinPluginRegistration,
  type PluginDescriptor,
} from '../app/boot/descriptor.js';
import { DesktopProjection } from '../app/desktop/host/projection-service.js';
import { DesktopReceiver } from '../app/desktop/host/receiver-service.js';
import { DesktopApplication } from '../services/desktop-application.js';
import desktopApplication from './application/desktop-application.js';

export interface DesktopBuiltinDefinition {
  descriptor: Omit<PluginDescriptor, 'codeDigest'>;
  plugin: BuiltinPluginRegistration['plugin'];
  sourceFiles: readonly string[];
}

const VERSION = '0.1.0';

export const desktopBuiltinDefinitions: readonly DesktopBuiltinDefinition[] = [
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
      id: 'desktop-projection-service',
      version: VERSION,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      configSchemaVersion: '1',
      kind: 'service-provider',
      source: 'builtin',
      compositions: ['desktop'],
      authorities: ['desktop-projection-state'],
      permissions: [],
      stateSchemas: { 'desktop-projection': '1' },
    },
    plugin: DesktopProjection,
    sourceFiles: [
      'app/desktop/host/projection-journal-store.ts',
      'app/desktop/host/projection-service.ts',
      'domains/telemetry/change-projection.ts',
    ],
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
      'app/desktop/host/receiver-service.ts',
      'app/desktop/host/otlp-http-receiver.ts',
      'app/desktop/host/otlp-json-projection.ts',
    ],
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

/** Minimal catalog for the packaged Host; it cannot pull project-only tools into the desktop bundle. */
export async function createDesktopBuiltinCatalog(
  productRoot: string,
): Promise<ReadonlyMap<string, BuiltinPluginRegistration>> {
  const registrations = await Promise.all(
    desktopBuiltinDefinitions.map(async (definition) => ({
      descriptor: {
        ...definition.descriptor,
        codeDigest: await codeDigest(productRoot, definition.sourceFiles),
      },
      plugin: definition.plugin,
    })),
  );
  return createBuiltinCatalog(registrations);
}
