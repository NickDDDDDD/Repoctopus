import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createBuiltinCatalog,
  PLUGIN_CONTRACT_VERSION,
  type BuiltinPluginRegistration,
  type PluginDescriptor,
} from '../../boot/descriptor.js';
import { bootApp, type RunningApp } from '../../boot/boot.js';
import { compileComposition } from '../../boot/composition.js';
import desktopApplication from '../../../plugins/application/desktop-application.js';
import { DesktopApplication } from '../../../services/desktop-application.js';
import { DesktopProjection } from '../../../services/desktop-projection.js';
import { DesktopReceiver } from '../../../services/desktop-receiver.js';

interface DesktopDefinition {
  descriptor: Omit<PluginDescriptor, 'codeDigest'>;
  plugin: BuiltinPluginRegistration['plugin'];
  sourceFiles: readonly string[];
}

const VERSION = '0.1.0';
const definitions: readonly DesktopDefinition[] = [
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

async function desktopCatalog(productRoot: string) {
  return createBuiltinCatalog(
    await Promise.all(
      definitions.map(async (definition) => ({
        descriptor: {
          ...definition.descriptor,
          codeDigest: await codeDigest(productRoot, definition.sourceFiles),
        },
        plugin: definition.plugin,
      })),
    ),
  );
}

/** Boot only the four Desktop plugins so packaged startup cannot initialize CLI-only dependencies. */
export async function bootDesktopComposition(productRoot: string): Promise<RunningApp> {
  const catalog = await desktopCatalog(productRoot);
  const composition = compileComposition(
    {
      id: 'repoctopus-desktop',
      kind: 'desktop',
      plugins: [
        { id: 'desktop-application-service' },
        { id: 'desktop-projection-service' },
        { id: 'desktop-receiver-service' },
        { id: 'desktop-application' },
      ],
      requiredServices: ['desktopApplication', 'desktopProjection', 'desktopReceiver'],
    },
    catalog,
  );
  return bootApp({ composition, catalog });
}
