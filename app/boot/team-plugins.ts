import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Plugin } from '@deepseek-ai/cordis';

import type { TeamPluginConfig } from '../../domains/project-configuration/types.js';
import {
  normalizePluginDescriptor,
  type BuiltinPluginRegistration,
  type PluginDescriptor,
} from './descriptor.js';
import { validateStaticPluginConfig } from './static-config-schema.js';

interface AdmittedTeamPlugin {
  config: TeamPluginConfig;
  descriptor: PluginDescriptor;
  moduleFile: string;
}

function sha256(source: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

export async function admitTeamPlugins(
  workspaceRoot: string,
  configured: readonly TeamPluginConfig[],
): Promise<readonly AdmittedTeamPlugin[]> {
  return Promise.all(
    configured.map(async (config) => {
      const descriptorFile = path.resolve(workspaceRoot, config.descriptor);
      const moduleFile = path.resolve(workspaceRoot, config.module);
      const [descriptorSource, moduleSource] = await Promise.all([
        readFile(descriptorFile, 'utf8'),
        readFile(moduleFile),
      ]);
      const descriptor = normalizePluginDescriptor(
        JSON.parse(descriptorSource) as PluginDescriptor,
      );
      if (descriptor.source !== 'team') {
        throw new Error(`Team plugin descriptor has invalid source: ${descriptor.id}`);
      }
      if (descriptor.id !== config.id) {
        throw new Error(`Team plugin id does not match its descriptor: ${config.id}`);
      }
      validateStaticPluginConfig(
        descriptor.configSchema!,
        config.config === undefined ? {} : config.config,
        `${descriptor.id}.config`,
      );
      const actualDigest = sha256(moduleSource);
      if (descriptor.codeDigest !== actualDigest) {
        throw new Error(
          `Team plugin code digest mismatch for ${descriptor.id}: expected ${descriptor.codeDigest}, received ${actualDigest}`,
        );
      }
      return { config, descriptor, moduleFile };
    }),
  );
}

export async function importTeamPlugins(
  admitted: readonly AdmittedTeamPlugin[],
): Promise<readonly BuiltinPluginRegistration[]> {
  return Promise.all(
    admitted.map(async ({ config, descriptor, moduleFile }) => {
      const loaded = (await import(
        `${pathToFileURL(moduleFile).href}?sha256=${descriptor.codeDigest.slice('sha256:'.length)}`
      )) as { default?: unknown };
      if (typeof loaded.default !== 'function') {
        throw new Error(`Team plugin must export a default Cordis Plugin: ${descriptor.id}`);
      }
      return {
        descriptor,
        plugin: loaded.default as Plugin,
        ...(config.config === undefined ? {} : { defaultConfig: config.config }),
      };
    }),
  );
}
